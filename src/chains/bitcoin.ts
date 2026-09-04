import type { ScanResult } from "./types.js";

// mempool.space's REST API is free and keyless.
export async function fetchBitcoin(address: string): Promise<ScanResult> {
  try {
    const [addrRes, txRes] = await Promise.all([
      fetch(`https://mempool.space/api/address/${address}`),
      fetch(`https://mempool.space/api/address/${address}/txs`),
    ]);
    if (!addrRes.ok) throw new Error(`mempool.space address responded ${addrRes.status}`);
    if (!txRes.ok) throw new Error(`mempool.space txs responded ${txRes.status}`);

    const overview = await addrRes.json();
    const txs = await txRes.json();
    return { chain: "bitcoin", address, ok: true, data: { overview, txs } };
  } catch (err) {
    return { chain: "bitcoin", address, ok: false, error: (err as Error).message };
  }
}
