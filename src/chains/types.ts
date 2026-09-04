export type ChainKey =
  | "ethereum"
  | "base"
  | "polygon"
  | "robinhood"
  | "hyperevm"
  | "solana"
  | "ton"
  | "bitcoin"
  | "sui";

export interface ScanResult {
  chain: ChainKey;
  address: string;
  ok: boolean;
  error?: string;
  // Loosely typed on purpose — every chain API shapes this differently.
  // The AI layer is what turns this into a human read, not our code.
  data?: Record<string, unknown>;
}
