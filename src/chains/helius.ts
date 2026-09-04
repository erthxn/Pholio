import { config } from "../config.js";
import type { ScanResult } from "./types.js";

export async function fetchSolana(address: string): Promise<ScanResult> {
  try {
    const balancesUrl = `https://api.helius.xyz/v1/addresses/${address}/balances?api-key=${config.heliusApiKey}`;
    const txUrl = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${config.heliusApiKey}&limit=25`;

    const [balancesRes, txRes] = await Promise.all([fetch(balancesUrl), fetch(txUrl)]);
    if (!balancesRes.ok) throw new Error(`Helius balances responded ${balancesRes.status}`);
    if (!txRes.ok) throw new Error(`Helius transactions responded ${txRes.status}`);

    const balances = await balancesRes.json();
    const transactions = await txRes.json();
    return { chain: "solana", address, ok: true, data: { balances, transactions } };
  } catch (err) {
    return { chain: "solana", address, ok: false, error: (err as Error).message };
  }
}
