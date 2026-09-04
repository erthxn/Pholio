import { extractAddressCandidate } from "../chains/detect.js";

export type Intent =
  | { kind: "scan"; address: string }
  | { kind: "wipe-memory" }
  | { kind: "go-quiet" } // "stop replying to others" / leave-group-alone style asks
  | { kind: "chat" };

// Lightweight pre-filter before we bother the LLM — cheap, deterministic asks
// (memory wipe, go quiet) shouldn't cost a model call to detect.
const WIPE_PATTERNS = /\b(forget everything|wipe your memory|clear my history|start fresh|reset memory)\b/i;
const QUIET_PATTERNS = /\b(stop replying|go quiet|leave (this|the) (chat|group) alone|don'?t respond to others)\b/i;

export function detectIntent(text: string): Intent {
  if (WIPE_PATTERNS.test(text)) return { kind: "wipe-memory" };
  if (QUIET_PATTERNS.test(text)) return { kind: "go-quiet" };

  const address = extractAddressCandidate(text);
  if (address) return { kind: "scan", address };

  return { kind: "chat" };
}
