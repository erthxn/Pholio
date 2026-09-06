import fs from "node:fs/promises";
import path from "node:path";
import { fetchMarketSnapshot, fetchMarketHistory } from "../chains/coingecko.js";
import { buildPriceLineChartUrl } from "../chains/quickchart.js";
import { CHAIN_LABELS } from "../chains/aliases.js";
import { askPholio } from "../ai/gemini.js";
import type { ChainKey } from "../chains/types.js";

export type MarketOutcome =
  | { kind: "image"; filePath: string; caption: string }
  | { kind: "failed"; reply: string };

/**
 * "What's happening in Solana" style bare chain question, distinct from a
 * wallet scan, no address involved. Real price and a real 24h price line,
 * both from CoinGecko, never modeled.
 */
export async function buildMarketOutcome(chain: ChainKey): Promise<MarketOutcome> {
  const label = CHAIN_LABELS[chain];

  let snapshot;
  let history;
  try {
    [snapshot, history] = await Promise.all([fetchMarketSnapshot(chain), fetchMarketHistory(chain)]);
  } catch (err) {
    return {
      kind: "failed",
      reply: `couldn't pull live market data for ${label} right now (${(err as Error).message}). want me to try again?`,
    };
  }

  if (history.length === 0) {
    return { kind: "failed", reply: `CoinGecko didn't return a price history for ${label} just now, nothing real to chart.` };
  }

  const chartUrl = buildPriceLineChartUrl({
    label,
    points: history.map((p) => ({ x: p.timestampMs, y: p.usd })),
  });

  const imgRes = await fetch(chartUrl);
  if (!imgRes.ok) {
    return { kind: "failed", reply: "QuickChart didn't render that chart just now. want me to retry?" };
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const filePath = path.join("/tmp", `market-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await fs.writeFile(filePath, buf);

  const summary = await askPholio(
    [],
    `Live market data for ${label}: ${JSON.stringify(snapshot)}.
Write a brief, plain-English take on this: the price, the 24h change (call
out clearly whether it's up or down), and one honest word on momentum
(only from this data, don't speculate beyond it). Two or three sentences,
text-message length. Every number must come from the data above.`
  );

  return { kind: "image", filePath, caption: summary };
}
