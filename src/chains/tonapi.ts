import { config } from "../config.js";
import type { ScanResult } from "./types.js";

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
export async function fetchTon(address: string): Promise<ScanResult> {
  try {
    const headers = { Authorization: `Bearer ${config.tonApiKey}` };
    const [accountRes, txRes, jettonsRes] = await Promise.all([
      fetch(`https://tonapi.io/v2/accounts/${address}`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${address}/events?limit=25`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${address}/jettons?currencies=usd`, { headers }),
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
    }

    return { chain: "ton", address, ok: true, data: { account, events, jettons, jettonsError } };
  } catch (err) {
    return { chain: "ton", address, ok: false, error: (err as Error).message };
  }
}
