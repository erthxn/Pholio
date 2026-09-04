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
  | { kind: "result"; reply: string; chain: ChainKey; raw: unknown }
  | { kind: "failed"; reply: string };

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
 * Always hits the live APIs — a cached ai_summary is never reused here.
 */
export async function runScan(params: {
  userId: number;
  address: string;
  chain: ChainKey;
}): Promise<ScanOutcome> {
  const result = await fetchByChain(params.chain, params.address);

  if (!result.ok) {
    return {
      kind: "failed",
      reply: `couldn't pull ${params.chain} data for that address right now — the API didn't respond (${result.error}). want me to try again?`,
    };
  }

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

  return { kind: "result", reply: summary, chain: params.chain, raw: result.data };
}

/**
 * Entry point for "scan this address" style requests. Classifies the address;
 * if it's on the shared EVM format, checks all candidate chains in parallel
 * and only asks the user when more than one genuinely has activity.
 */
export async function startScan(address: string): Promise<ScanOutcome | { kind: "unique"; chain: ChainKey }> {
  const classification = classifyAddress(address);

  if (classification.kind === "none") {
    return { kind: "failed", reply: "that doesn't look like a wallet address I recognize — mind double-checking it?" };
  }

  if (classification.kind === "unique") {
    return { kind: "unique", chain: classification.chain };
  }

  // evm-ambiguous: figure out where it's actually active before bothering the user
  const active = await findActiveEvmChains(EVM_CANDIDATE_CHAINS, address);
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
