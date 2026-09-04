import { config } from "../config.js";
import type { ScanResult } from "./types.js";

export async function fetchTon(address: string): Promise<ScanResult> {
  try {
    const headers = { Authorization: `Bearer ${config.tonApiKey}` };
    const [accountRes, txRes] = await Promise.all([
      fetch(`https://tonapi.io/v2/accounts/${address}`, { headers }),
      fetch(`https://tonapi.io/v2/accounts/${address}/events?limit=25`, { headers }),
    ]);
    if (!accountRes.ok) throw new Error(`TonAPI account responded ${accountRes.status}`);
    if (!txRes.ok) throw new Error(`TonAPI events responded ${txRes.status}`);

    const account = await accountRes.json();
    const events = await txRes.json();
    return { chain: "ton", address, ok: true, data: { account, events } };
  } catch (err) {
    return { chain: "ton", address, ok: false, error: (err as Error).message };
  }
}
