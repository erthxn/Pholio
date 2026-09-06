import { classifyAddress, EVM_CANDIDATE_CHAINS } from "../chains/detect.js";
import { fetchEvmChain, findActiveEvmChains } from "../chains/blockscout.js";
import { fetchSolana } from "../chains/helius.js";
import { fetchTon } from "../chains/tonapi.js";
import { fetchBitcoin } from "../chains/bitcoin.js";
import { fetchSui } from "../chains/sui.js";
import type { ChainKey, ScanResult } from "../chains/types.js";
import { askPholio } from "../ai/gemini.js";
import { buildScanPrompt } from "../ai/personality.js";
import { saveScan } from "../db.js";

export type ScanOutcome =
  | { kind: "needs-chain-choice"; address: string; candidates: ChainKey[] }
  | { kind: "result"; reply: string; chain: ChainKey; raw: Record<string, unknown> }
  | { kind: "failed"; reply: string };

/** The subset of ScanOutcome that runScan() can actually produce, it never returns needs-chain-choice. */
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
 * Runs a full scan for an address the user has already committed to a chain
 * for (either it was unambiguous, or they answered "which chain?").
 * Always hits the live APIs, a cached ai_summary is never reused here. The
 * raw data comes back to the caller (index.ts) which builds the portfolio
 * mix chart and structured report from it, this function only produces the
 * plain-English read and persists the scan.
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
      reply: `couldn't pull ${params.chain} data for that address right now, the API didn't respond (${result.error}). want me to try again?`,
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

  console.log(`[scan] ${params.chain} scan for ${params.address} complete`);
  return { kind: "result", reply: summary, chain: params.chain, raw: result.data ?? {} };
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
    return { kind: "failed", reply: "that doesn't look like a wallet address I recognize, mind double-checking it?" };
  }

  if (classification.kind === "unique") {
    return { kind: "unique", chain: classification.chain };
  }

  console.log(`[scan] "${address}" is EVM-shaped, checking ${EVM_CANDIDATE_CHAINS.join(", ")} for activity`);
  const active = await findActiveEvmChains(EVM_CANDIDATE_CHAINS, address);
  console.log(`[scan] "${address}" active on: ${active.map((r) => r.chain).join(", ") || "none"}`);
  if (active.length === 1) {
    return { kind: "unique", chain: active[0].chain };
  }
  if (active.length === 0) {
    return { kind: "unique", chain: "ethereum" };
  }
  return {
    kind: "needs-chain-choice",
    address,
    candidates: active.map((r) => r.chain),
  };
}
