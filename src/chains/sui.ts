import type { ScanResult } from "./types.js";

const SUI_RPC = "https://fullnode.mainnet.sui.io:443";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(SUI_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Sui RPC ${method} responded ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Sui RPC error: ${json.error.message}`);
  return json.result;
}

export async function fetchSui(address: string): Promise<ScanResult> {
  try {
    const [balances, txs] = await Promise.all([
      rpc("suix_getAllBalances", [address]),
      rpc("suix_queryTransactionBlocks", [
        { filter: { FromAddress: address }, options: {} },
        null,
        25,
        true,
      ]),
    ]);
    return { chain: "sui", address, ok: true, data: { balances, txs } };
  } catch (err) {
    return { chain: "sui", address, ok: false, error: (err as Error).message };
  }
}
