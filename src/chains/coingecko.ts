import type { ChainKey } from "./types.js";

/**
 * CoinGecko's free public API, no key needed, used for chain-level "what's
 * happening in X" questions (price, 24h change, a real price line). This is
 * separate from dexscreener.ts, which is for a specific token contract, not
 * a whole chain's native asset.
 */
const COINGECKO_IDS: Partial<Record<ChainKey, string>> = {
  ethereum: "ethereum",
  base: "ethereum", // Base has no separate market asset, it settles in ETH
  polygon: "matic-network",
  solana: "solana",
  ton: "the-open-network", // still listed under this id; the asset itself is now called Gram (GRAM)
  bitcoin: "bitcoin",
  sui: "sui",
};

export interface MarketSnapshot {
  usd: number;
  usd_24h_change?: number;
  usd_24h_vol?: number;
}

export interface MarketPoint {
  timestampMs: number;
  usd: number;
}

/** Live price + 24h stats for a chain's native asset. Throws if unsupported or the API fails, never returns a guessed number. */
export async function fetchMarketSnapshot(chain: ChainKey): Promise<MarketSnapshot> {
  const id = COINGECKO_IDS[chain];
  if (!id) throw new Error(`no market data source configured for ${chain} yet`);

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
  );
  if (!res.ok) throw new Error(`CoinGecko price responded ${res.status}`);
  const json = await res.json();
  const entry = json?.[id];
  if (!entry || typeof entry.usd !== "number") throw new Error("CoinGecko returned no usable price");
  return entry;
}

/** Real 24h price history as [timestamp, usd] points, for charting, never interpolated or modeled. */
export async function fetchMarketHistory(chain: ChainKey): Promise<MarketPoint[]> {
  const id = COINGECKO_IDS[chain];
  if (!id) throw new Error(`no market data source configured for ${chain} yet`);

  const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`);
  if (!res.ok) throw new Error(`CoinGecko market_chart responded ${res.status}`);
  const json = await res.json();
  const prices: [number, number][] = Array.isArray(json?.prices) ? json.prices : [];
  return prices.map(([t, usd]) => ({ timestampMs: t, usd }));
}
