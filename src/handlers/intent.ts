import { extractAddressCandidates } from "../chains/detect.js";

export type Intent =
  | { kind: "scan"; addresses: string[] }
  | { kind: "chart"; address: string }
  | { kind: "wipe-memory" }
  | { kind: "go-quiet" } // "stop replying to others" / leave-group-alone style asks
  | { kind: "chat" };

// Lightweight pre-filter before we bother the LLM — cheap, deterministic asks
// (memory wipe, go quiet) shouldn't cost a model call to detect.
const WIPE_PATTERNS = /\b(forget everything|wipe your memory|clear my history|start fresh|reset memory)\b/i;
const QUIET_PATTERNS = /\b(stop replying|go quiet|leave (this|the) (chat|group) alone|don'?t respond to others)\b/i;
// Bug fix: this used to be /\b(chart|candlestick|candles?|price history)\b/i,
// which needs a word boundary *after* "chart" too — so "charts" (with an
// "s" right after) never matched, and "I need the charts" for an address
// fell through to a plain scan instead of the chart flow.
const CHART_PATTERNS = /\b(charts?|candlestick|candles?|price history)\b/i;

export function detectIntent(text: string): Intent {
  if (WIPE_PATTERNS.test(text)) return { kind: "wipe-memory" };
  if (QUIET_PATTERNS.test(text)) return { kind: "go-quiet" };

  const addresses = extractAddressCandidates(text);
  if (addresses.length > 0) {
    // "chart 0x..." style requests want an image, not a text scan — checked
    // before the plain scan path since both start from the same address.
    if (CHART_PATTERNS.test(text)) {
      console.log(`[intent] "chart" intent for ${addresses[0]}`);
      return { kind: "chart", address: addresses[0] };
    }
    console.log(`[intent] "scan" intent for ${addresses.length} address(es): ${addresses.join(", ")}`);
    return { kind: "scan", addresses };
  }

  return { kind: "chat" };
}
