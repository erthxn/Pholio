import fs from "node:fs/promises";
import path from "node:path";
import { fetchTokenPrice } from "../chains/dexscreener.js";
import { buildMomentumChartUrl, type ChangePoint } from "../chains/quickchart.js";

export type ChartOutcome =
  | { kind: "image"; filePath: string; caption: string }
  | { kind: "failed"; reply: string };

interface DexPair {
  baseToken?: { symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  priceChange?: Record<string, number>;
}

const WINDOWS: Array<[string, string]> = [
  ["m5", "5m"],
  ["h1", "1h"],
  ["h6", "6h"],
  ["h24", "24h"],
];

/**
 * Builds a real chart image from live DexScreener data for a token contract
 * address. Never invents a data point, if DexScreener doesn't have
 * something (no pairs, no price-change window), that piece is just left out
 * rather than filled in.
 */
export async function buildChartOutcome(address: string): Promise<ChartOutcome> {
  let json: { pairs?: DexPair[] };
  try {
    json = await fetchTokenPrice(address);
  } catch (err) {
    return {
      kind: "failed",
      reply: `couldn't pull price data for that from DexScreener right now (${(err as Error).message}). want me to try again?`,
    };
  }

  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  if (pairs.length === 0) {
    return {
      kind: "failed",
      reply: "DexScreener doesn't have any trading pairs for that address, so there's nothing real to chart. is it a token contract, not a wallet?",
    };
  }

  const pair = pairs.reduce((best, p) =>
    Number(p.liquidity?.usd ?? 0) > Number(best.liquidity?.usd ?? 0) ? p : best
  );

  const changeSource = pair.priceChange ?? {};
  const changes: ChangePoint[] = WINDOWS.filter(([key]) => typeof changeSource[key] === "number").map(
    ([key, label]) => ({ label, value: changeSource[key] })
  );

  if (changes.length === 0) {
    return {
      kind: "failed",
      reply: "DexScreener didn't return any price-change data for that pair, so there's nothing real to chart yet.",
    };
  }

  const symbol = pair.baseToken?.symbol ?? "token";
  const chartUrl = buildMomentumChartUrl({ symbol, changes });

  const imgRes = await fetch(chartUrl);
  if (!imgRes.ok) {
    return { kind: "failed", reply: "QuickChart didn't render that chart just now. want me to retry?" };
  }

  const buf = Buffer.from(await imgRes.arrayBuffer());
  const filePath = path.join("/tmp", `chart-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await fs.writeFile(filePath, buf);

  const priceLine = pair.priceUsd ? `${symbol} is at $${pair.priceUsd} right now. ` : "";
  const caption = `${priceLine}price change across ${changes.map((c) => c.label).join(", ")} is in the chart above, straight from DexScreener, nothing modeled or guessed.`;

  return { kind: "image", filePath, caption };
}
