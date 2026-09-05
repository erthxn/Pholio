import fs from "node:fs/promises";
import path from "node:path";
import { classifyAddress, EVM_CANDIDATE_CHAINS } from "../chains/detect.js";
import { fetchEvmChain, findActiveEvmChains } from "../chains/blockscout.js";
import { fetchSolana } from "../chains/helius.js";
import { fetchTon, extractTonJettonHoldings } from "../chains/tonapi.js";
import { fetchBitcoin } from "../chains/bitcoin.js";
import { fetchSui } from "../chains/sui.js";
import { buildHoldingsChartUrl } from "../chains/quickchart.js";
import type { ChainKey, ScanResult } from "../chains/types.js";
import { askPholio } from "../ai/gemini.js";
import { buildScanPrompt } from "../ai/personality.js";
import { saveScan } from "../db.js";

export type ScanOutcome =
  | { kind: "needs-chain-choice"; address: string; candidates: ChainKey[] }
  | { kind: "result"; reply: string; chain: ChainKey; raw: unknown; chartFilePath?: string }
  | { kind: "failed"; reply: string };

/** The subset of ScanOutcome that runScan() can actually produce — it never returns needs-chain-choice. */
type RunScanOutcome = Extract<ScanOutcome, { kind: "result" } | { kind: "failed" }>;

async function fetchByChain(chain: ChainKey, address: string): Promise<ScanResult> {
  switch (chain) {
    case "solana":
      return fetchSolana(address);
    case "ton":
      return fetchTon(address);
    case "bitcoin":
      return fetchBitcoin(address);
    case "sui":
      return fetchSui(address);
    default:
      return fetchEvmChain(chain, address);
  }
}

/**
 * Best-effort chart for a wallet scan (not the token-price chart in
 * chart.ts). Only TON exposes USD-priced holdings straight from the account
 * fetch today; other chains return `null` here and the scan just stays
 * text-only, same as before, rather than guessing a number to plot.
 */
async function buildScanChart(chain: ChainKey, address: string, data: unknown): Promise<string | null> {
  if (chain !== "ton") return null;

  const holdings = extractTonJettonHoldings(data as Record<string, unknown> | undefined);
  if (holdings.length === 0) {
    console.log(`[scan] no USD-priced jetton holdings to chart for ${address}`);
    return null;
  }

  try {
    const chartUrl = buildHoldingsChartUrl({ title: `${address} jetton holdings (USD)`, holdings });
    const imgRes = await fetch(chartUrl);
    if (!imgRes.ok) {
      console.error(`[scan] QuickChart responded ${imgRes.status} for ${address}`);
      return null;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const filePath = path.join("/tmp", `scan-chart-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fs.writeFile(filePath, buf);
    console.log(`[scan] built holdings chart for ${address} (${holdings.length} holdings)`);
    return filePath;
  } catch (err) {
    console.error(`[scan] failed to render holdings chart for ${address}`, err);
    return null;
  }
}

/**
 * Runs a full scan for an address the user has already committed to a chain
 * for (either it was unambiguous, or they answered "which chain?").
 * Always hits the live APIs — a cached ai_summary is never reused here.
 */
export async function runScan(params: {
  userId: number;
  address: string;
  chain: ChainKey;
}): Promise<RunScanOutcome> {
  console.log(`[scan] running ${params.chain} scan for ${params.address} (user ${params.userId})`);
  const result = await fetchByChain(params.chain, params.address);

  if (!result.ok) {
    console.error(`[scan] ${params.chain} scan for ${params.address} failed: ${result.error}`);
    return {
      kind: "failed",
      reply: `couldn't pull ${params.chain} data for that address right now — the API didn't respond (${result.error}). want me to try again?`,
    };
  }

  console.log(`[scan] ${params.chain} scan for ${params.address} got live data, asking Pholio for a read`);
  const summary = await askPholio(
    [],
    buildScanPrompt({ address: params.address, chain: params.chain, rawData: result.data })
  );

  await saveScan({
    userId: params.userId,
    address: params.address,
    chain: params.chain,
    rawData: result.data,
    aiSummary: summary,
  });

  const chartFilePath = await buildScanChart(params.chain, params.address, result.data);
  console.log(`[scan] ${params.chain} scan for ${params.address} complete${chartFilePath ? " (with chart)" : ""}`);

  return { kind: "result", reply: summary, chain: params.chain, raw: result.data, chartFilePath: chartFilePath ?? undefined };
}

/**
 * Entry point for "scan this address" style requests. Classifies the address;
 * if it's on the shared EVM format, checks all candidate chains in parallel
 * and only asks the user when more than one genuinely has activity.
 */
export async function startScan(address: string): Promise<ScanOutcome | { kind: "unique"; chain: ChainKey }> {
  const classification = classifyAddress(address);
  console.log(`[scan] classified "${address}" as ${classification.kind}`);

  if (classification.kind === "none") {
    return { kind: "failed", reply: "that doesn't look like a wallet address I recognize — mind double-checking it?" };
  }

  if (classification.kind === "unique") {
    return { kind: "unique", chain: classification.chain };
  }

  // evm-ambiguous: figure out where it's actually active before bothering the user
  console.log(`[scan] "${address}" is EVM-shaped, checking ${EVM_CANDIDATE_CHAINS.join(", ")} for activity`);
  const active = await findActiveEvmChains(EVM_CANDIDATE_CHAINS, address);
  console.log(`[scan] "${address}" active on: ${active.map((r) => r.chain).join(", ") || "none"}`);
  if (active.length === 1) {
    return { kind: "unique", chain: active[0].chain };
  }
  if (active.length === 0) {
    // No activity anywhere we checked — default to Ethereum so we still say something useful.
    return { kind: "unique", chain: "ethereum" };
  }
  return {
    kind: "needs-chain-choice",
    address,
    candidates: active.map((r) => r.chain),
  };
}
