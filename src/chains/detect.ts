import type { ChainKey } from "./types.js";

/**
 * Every EVM chain we support shares the exact same 0x + 40 hex char format.
 * We can't tell them apart from the string alone — resolve.ts settles this
 * by checking which ones actually have activity.
 */
export const EVM_CANDIDATE_CHAINS: ChainKey[] = [
  "ethereum",
  "base",
  "polygon",
  "robinhood",
  "hyperevm",
];

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SUI_RE = /^0x[a-fA-F0-9]{64}$/; // Sui = 32-byte address, 66 chars total incl. 0x
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0/O/I/l
const TON_RE = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/; // friendly-form TON addresses
const BTC_RE = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,90})$/;

export type Classification =
  | { kind: "unique"; chain: ChainKey }
  | { kind: "evm-ambiguous"; candidates: ChainKey[] }
  | { kind: "none" };

/**
 * Classifies a string that looks like it might be an address.
 * Order matters: check the unambiguous, distinctive formats first,
 * and only fall into the EVM bucket (which needs live disambiguation)
 * as a last resort.
 */
export function classifyAddress(raw: string): Classification {
  const value = raw.trim();

  if (BTC_RE.test(value)) return { kind: "unique", chain: "bitcoin" };
  if (TON_RE.test(value)) return { kind: "unique", chain: "ton" };
  if (SUI_RE.test(value)) return { kind: "unique", chain: "sui" };
  if (EVM_RE.test(value)) return { kind: "evm-ambiguous", candidates: EVM_CANDIDATE_CHAINS };
  // Solana check last — base58 is a loose format and can false-positive
  // on things that aren't addresses at all, so only trust it once every
  // more specific pattern above has failed.
  if (SOLANA_RE.test(value) && value.length >= 32) return { kind: "unique", chain: "solana" };

  return { kind: "none" };
}

/**
 * Pulls a plausible address-looking token out of a free-text message.
 * This is intentionally loose — the LLM intent layer decides whether the
 * user actually wants a scan; this just finds the candidate string.
 */
export function extractAddressCandidate(text: string): string | null {
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    const cleaned = token.replace(/[.,!?]+$/, "");
    if (classifyAddress(cleaned).kind !== "none") return cleaned;
  }
  return null;
}
