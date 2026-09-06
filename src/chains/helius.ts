import { config } from "../config.js";
import type { ScanResult } from "./types.js";

/**
 * Helius gives balances and transactions but not USD prices for arbitrary
 * SPL tokens. Jupiter's price API is free, keyless, and covers most tokens
 * that actually trade on Solana, including memecoins, so it's the second
 * call that turns raw token amounts into a priced holding.
 */
async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const res = await fetch(`https://price.jup.ag/v6/price?ids=${mints.join(",")}`);
    if (!res.ok) return {};
    const json = await res.json();
    const prices: Record<string, number> = {};
    for (const [mint, entry] of Object.entries<any>(json?.data ?? {})) {
      if (typeof entry?.price === "number") prices[mint] = entry.price;
    }
    return prices;
  } catch (err) {
    console.error("[helius] Jupiter price lookup failed", err);
    return {};
  }
}

export async function fetchSolana(address: string): Promise<ScanResult> {
  try {
    const balancesUrl = `https://api.helius.xyz/v1/addresses/${address}/balances?api-key=${config.heliusApiKey}`;
    const txUrl = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${config.heliusApiKey}&limit=25`;

    const [balancesRes, txRes] = await Promise.all([fetch(balancesUrl), fetch(txUrl)]);
    if (!balancesRes.ok) throw new Error(`Helius balances responded ${balancesRes.status}`);
    if (!txRes.ok) throw new Error(`Helius transactions responded ${txRes.status}`);

    const balances = await balancesRes.json();
    const transactions = await txRes.json();

    // Enrich whatever SPL tokens Helius found with a live USD price where
    // one exists. A token with no Jupiter price just stays unpriced, never
    // a guessed value, portfolioMix.ts leaves those out of the USD totals.
    const mints: string[] = Array.isArray(balances?.tokens)
      ? balances.tokens.map((t: any) => t.mint).filter(Boolean)
      : [];
    const tokenPrices = await fetchJupiterPrices(mints);

    return { chain: "solana", address, ok: true, data: { balances, transactions, tokenPrices } };
  } catch (err) {
    return { chain: "solana", address, ok: false, error: (err as Error).message };
  }
}
