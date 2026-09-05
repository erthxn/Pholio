import { config } from "../config.js";
import type { ScanResult } from "./types.js";
import { TON_DOMAIN_RE } from "./detect.js";

/**
 * Bug #4 fix, part one: this used to only pull the account's native TON
 * balance and recent events, never jetton (token) balances. Any jetton
 * sitting on the wallet was invisible to the AI, which is how it ended up
 * inventing a plausible-sounding number for one instead of saying it wasn't
 * there. Note this is separate from the native coin itself: TON's native
 * coin has gone by more than one name (TON, Toncoin, and originally Gram),
 * that's still just `account` below, not a jetton, see personality.ts for
 * how the prompt is told to treat that distinction.
 */

interface DomainResolution {
  address: string;
}

interface DomainResolveFailure {
  error: string;
}

/**
 * Bug #6 fix, part two: TonAPI's account endpoints don't accept a bare
 * ".ton" domain, they need a real wallet address. Previously nothing ever
 * called this because classifyAddress() didn't even recognize a domain as
 * an address (see detect.ts) — a domain scan silently skipped every real
 * API call and the model made up a full "scan" from nothing. This resolves
 * the domain first, live, so the rest of the pipeline works with a real
 * address exactly like any other TON scan.
 */
async function resolveTonDomain(
  domain: string,
  headers: Record<string, string>
): Promise<DomainResolution | DomainResolveFailure> {
  console.log(`[tonapi] resolving TON domain "${domain}"`);
  try {
    const res = await fetch(`https://tonapi.io/v2/dns/${domain}/resolve`, { headers });
    if (!res.ok) {
      console.error(`[tonapi] dns resolve for "${domain}" responded ${res.status}`);
      return { error: `TonAPI dns resolve responded ${res.status}` };
    }
    const record = await res.json();
    const address: string | undefined = record?.wallet?.address;
    if (!address) {
      console.error(`[tonapi] dns resolve for "${domain}" had no wallet address in the response`);
      return { error: "that domain doesn't resolve to a wallet address" };
    }
    console.log(`[tonapi] resolved "${domain}" -> ${address}`);
    return { address };
  } catch (err) {
    console.error(`[tonapi] dns resolve for "${domain}" threw`, err);
    return { error: (err as Error).message };
  }
}

export async function fetchTon(address: string): Promise<ScanResult> {
  const headers = { Authorization: `Bearer ${config.tonApiKey}` };
  let targetAddress = address;
  let resolvedFromDomain: string | null = null;

  if (TON_DOMAIN_RE.test(address)) {
    const resolved = await resolveTonDomain(address, headers);
    if ("error" in resolved) {
      return { chain: "ton", address, ok: false, error: resolved.error };
    }
    targetAddress = resolved.address;
    resolvedFromDomain = address;
  }

  console.log(
    `[tonapi] scanning ${targetAddress}${resolvedFromDomain ? ` (resolved from domain ${resolvedFromDomain})` : ""}`
  );

  try {
    const [accountRes, txRes, jettonsRes] = await Promise.all([
      fetch(`https://tonapi.io/v2/accounts/${targetAddress}`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${targetAddress}/events?limit=25`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${targetAddress}/jettons?currencies=usd`, { headers }),
    ]);
    if (!accountRes.ok) throw new Error(`TonAPI account responded ${accountRes.status}`);
    if (!txRes.ok) throw new Error(`TonAPI events responded ${txRes.status}`);

    const account = await accountRes.json();
    const events = await txRes.json();

    // Jettons are additive on top of the core account+events read — if this
    // one call fails, don't fail the whole scan over it, just be explicit
    // that we don't have jetton data this time so the model can say so
    // plainly instead of guessing.
    let jettons: unknown = null;
    let jettonsError: string | null = null;
    if (jettonsRes.ok) {
      jettons = await jettonsRes.json();
    } else {
      jettonsError = `TonAPI jettons responded ${jettonsRes.status}`;
      console.error(`[tonapi] jettons lookup for ${targetAddress} responded ${jettonsRes.status}`);
    }

    console.log(`[tonapi] scan of ${targetAddress} succeeded`);
    return {
      chain: "ton",
      address: targetAddress,
      ok: true,
      data: { account, events, jettons, jettonsError, resolvedFromDomain },
    };
  } catch (err) {
    console.error(`[tonapi] scan of ${targetAddress} failed`, err);
    return { chain: "ton", address: targetAddress, ok: false, error: (err as Error).message };
  }
}

export interface JettonHolding {
  label: string;
  usdValue: number;
}

/**
 * Pulls out only the jetton holdings that TonAPI itself priced in USD (the
 * `currencies=usd` param on the jettons call above). Never estimates a price
 * for anything that didn't come back priced — an entry with no usable price
 * is just left out of the chart rather than guessed at.
 */
export function extractTonJettonHoldings(data: Record<string, unknown> | undefined): JettonHolding[] {
  const jettons = data?.jettons as { balances?: unknown[] } | null | undefined;
  const balances = Array.isArray(jettons?.balances) ? (jettons!.balances as any[]) : [];

  const holdings: JettonHolding[] = [];
  for (const entry of balances) {
    const rawBalance = Number(entry?.balance);
    const decimals = Number(entry?.jetton?.decimals ?? 0);
    const usdPrice = Number(entry?.price?.prices?.USD ?? entry?.price?.prices?.usd);
    const symbol = entry?.jetton?.symbol;
    if (!symbol || !Number.isFinite(rawBalance) || !Number.isFinite(usdPrice) || usdPrice <= 0) continue;

    const amount = rawBalance / 10 ** decimals;
    const usdValue = amount * usdPrice;
    if (!Number.isFinite(usdValue) || usdValue <= 0) continue;

    holdings.push({ label: symbol, usdValue });
  }

  return holdings.sort((a, b) => b.usdValue - a.usdValue).slice(0, 6);
}
