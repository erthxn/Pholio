import { fetchMarketSnapshot } from "./coingecko.js";
import { extractTonJettonHoldings } from "./tonapi.js";
import type { ChainKey } from "./types.js";

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "BUSD", "FDUSD", "TUSD", "USDE"]);

export interface MixCategory {
  label: string;
  usdValue: number;
}

export interface PortfolioMix {
  categories: MixCategory[]; // native, stablecoins, other/memecoin, each only if priced
  totalUsd: number;
  hasUnpricedHoldings: boolean; // true if something real exists but couldn't be priced, never silently dropped from the narrative
}

function bucket(symbol: string, nativeSymbol: string): "native" | "stable" | "other" {
  if (symbol.toUpperCase() === nativeSymbol.toUpperCase()) return "native";
  if (STABLE_SYMBOLS.has(symbol.toUpperCase())) return "stable";
  return "other";
}

const NATIVE_SYMBOL: Partial<Record<ChainKey, string>> = {
  ethereum: "ETH",
  base: "ETH",
  polygon: "MATIC",
  robinhood: "ETH",
  hyperevm: "ETH",
  solana: "SOL",
  ton: "GRAM",
  bitcoin: "BTC",
  sui: "SUI",
};

/**
 * Builds a native / stablecoin / other breakdown from whatever a chain's
 * scan already returned. Every USD figure here traces back to a live price
 * from the chain API itself (Blockscout's token exchange rate, TonAPI's
 * jetton USD price, Jupiter's Solana token price, or a live CoinGecko quote
 * for the native asset), nothing is estimated. Anything real but unpriced
 * sets hasUnpricedHoldings so the report can say so honestly instead of
 * pretending the portfolio is fully accounted for.
 */
export async function buildPortfolioMix(chain: ChainKey, data: Record<string, unknown>): Promise<PortfolioMix> {
  const buckets: Record<"native" | "stable" | "other", number> = { native: 0, stable: 0, other: 0 };
  let hasUnpricedHoldings = false;
  const nativeSymbol = NATIVE_SYMBOL[chain] ?? "NATIVE";

  // Native balance, priced live. If the live price lookup fails, the native
  // amount is still real, it's just left out of the USD totals rather than
  // guessed, and flagged as unpriced.
  try {
    const snapshot = await fetchMarketSnapshot(chain);
    const nativeAmount = extractNativeAmount(chain, data);
    if (nativeAmount !== null) {
      buckets.native += nativeAmount * snapshot.usd;
    }
  } catch {
    if (extractNativeAmount(chain, data) !== null) hasUnpricedHoldings = true;
  }

  if (chain === "ton") {
    for (const holding of extractTonJettonHoldings(data)) {
      const b = bucket(holding.label, nativeSymbol);
      buckets[b] += holding.usdValue;
    }
  }

  if (chain === "solana") {
    const tokens = (data.balances as any)?.tokens ?? [];
    const prices = (data.tokenPrices as Record<string, number>) ?? {};
    for (const t of tokens) {
      const price = prices[t.mint];
      const amount = Number(t.amount) / 10 ** Number(t.decimals ?? 0);
      if (!price || !Number.isFinite(amount)) {
        if (Number(t.amount) > 0) hasUnpricedHoldings = true;
        continue;
      }
      const symbol = t.symbol || "TOKEN";
      buckets[bucket(symbol, nativeSymbol)] += amount * price;
    }
  }

  if (["ethereum", "base", "polygon", "robinhood", "hyperevm"].includes(chain)) {
    const tokenList = (data.tokenBalances as any[]) ?? [];
    for (const entry of tokenList) {
      const symbol = entry?.token?.symbol;
      const decimals = Number(entry?.token?.decimals ?? 18);
      const exchangeRate = Number(entry?.token?.exchange_rate);
      const rawValue = Number(entry?.value);
      if (!symbol || !Number.isFinite(rawValue)) continue;
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        if (rawValue > 0) hasUnpricedHoldings = true;
        continue;
      }
      const amount = rawValue / 10 ** decimals;
      buckets[bucket(symbol, nativeSymbol)] += amount * exchangeRate;
    }
  }

  const categories: MixCategory[] = [
    { label: nativeSymbol, usdValue: buckets.native },
    { label: "stablecoins", usdValue: buckets.stable },
    { label: "other tokens", usdValue: buckets.other },
  ].filter((c) => c.usdValue > 0);

  const totalUsd = categories.reduce((sum, c) => sum + c.usdValue, 0);
  return { categories, totalUsd, hasUnpricedHoldings };
}

function extractNativeAmount(chain: ChainKey, data: Record<string, unknown>): number | null {
  if (chain === "ton") {
    const raw = Number((data.account as any)?.balance);
    return Number.isFinite(raw) ? raw / 1_000_000_000 : null;
  }
  if (chain === "solana") {
    const lamports = Number((data.balances as any)?.nativeBalance);
    return Number.isFinite(lamports) ? lamports / 1_000_000_000 : null;
  }
  if (["ethereum", "base", "polygon", "robinhood", "hyperevm"].includes(chain)) {
    const wei = Number((data.overview as any)?.coin_balance);
    return Number.isFinite(wei) ? wei / 1e18 : null;
  }
  return null;
}
