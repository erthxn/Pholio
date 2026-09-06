import { config } from "../config.js";
import type { ChainKey, ScanResult } from "./types.js";

// Blockscout's unified API is path-based: /{chain_id}/api/v2/...
// Chain IDs below are the standard EVM chain IDs for each network.
// NOTE: verify the hyperevm chain_id against Blockscout's supported-chains
// list before relying on it — EVM chain IDs for newer networks can shift.
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  robinhood: 4663,
  hyperevm: 999, // TODO: confirm before launch
};

async function blockscoutGet(chainKey: keyof typeof CHAIN_IDS, addressPath: string) {
  const chainId = CHAIN_IDS[chainKey];
  const url = `https://api.blockscout.com/${chainId}/api/v2/addresses/${addressPath}?apikey=${config.blockscoutApiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blockscout ${chainKey} responded ${res.status}`);
  return res.json();
}

/** Fetches balance, recent activity, and priced token holdings for one EVM chain. */
export async function fetchEvmChain(chain: ChainKey, address: string): Promise<ScanResult> {
  try {
    const [overview, txs, tokensRes] = await Promise.all([
      blockscoutGet(chain as keyof typeof CHAIN_IDS, address),
      blockscoutGet(chain as keyof typeof CHAIN_IDS, `${address}/transactions`),
      blockscoutGet(chain as keyof typeof CHAIN_IDS, `${address}/token-balances`).catch((err) => {
        // Additive on top of the core read, if this one call fails, don't
        // fail the whole scan over it, just say so plainly downstream.
        console.error(`[blockscout] token-balances for ${address} on ${chain} failed`, err);
        return null;
      }),
    ]);
    return { chain, address, ok: true, data: { overview, txs, tokenBalances: tokensRes } };
  } catch (err) {
    return { chain, address, ok: false, error: (err as Error).message };
  }
}

/**
 * Checks every candidate EVM chain in parallel and returns only the ones
 * where the address actually has activity (a balance or at least one tx).
 * This is what lets us skip asking "which chain?" whenever possible.
 */
export async function findActiveEvmChains(
  candidates: ChainKey[],
  address: string
): Promise<ScanResult[]> {
  const results = await Promise.all(candidates.map((c) => fetchEvmChain(c, address)));
  return results.filter((r) => {
    if (!r.ok || !r.data) return false;
    const overview = r.data.overview as Record<string, unknown> | undefined;
    const txs = r.data.txs as { items?: unknown[] } | undefined;
    const hasBalance = overview && Number(overview.coin_balance ?? 0) > 0;
    const hasTxs = (txs?.items?.length ?? 0) > 0;
    return Boolean(hasBalance || hasTxs);
  });
}
