import { extractAddressCandidates } from "../chains/detect.js";
import { findChainMentions } from "../chains/aliases.js";
import type { ChainKey } from "../chains/types.js";

export type Intent =
  | { kind: "scan"; addresses: string[] }
  | { kind: "chart"; address: string }
  | { kind: "market"; chain: ChainKey }
  | { kind: "identity" }
  | { kind: "greeting" }
  | { kind: "appreciation" }
  | { kind: "wipe-memory" }
  | { kind: "go-quiet" }
  | { kind: "chat" };

const WIPE_PATTERNS = /\b(forget everything|wipe your memory|clear my history|start fresh|reset memory)\b/i;
const QUIET_PATTERNS = /\b(stop replying|go quiet|leave (this|the) (chat|group) alone|don'?t respond to others)\b/i;
const CHART_PATTERNS = /\b(charts?|candlestick|candles?|price history)\b/i;

// Bare chain-level market question, no address involved ("what's happening
// in Solana", "price of ETH", "how's TON doing").
const MARKET_TRIGGER = /\b(what'?s (happening|going on|up|good) (in|with)|price of|how'?s .*(doing|looking)|market (update|check))\b/i;

// "Who are you / what can you do" style capability questions, distinct from
// ordinary chat since these get the intro sticker.
const IDENTITY_PATTERNS =
  /\b(who are you|what are you|what can you do|what do you do|how do you work|what is pholio|tell me about yourself|what's your (purpose|function))\b/i;

// Casual greeting with nothing else in the message, kept short and
// deliberately narrow so "hi, can you scan 0x..." still falls through to
// the address check below instead of being treated as just a greeting.
const GREETING_PATTERNS = /^\s*(hi+|hello+|hey+|yo+|sup|what'?s up)[.!? ]*$/i;

const APPRECIATION_PATTERNS = /\b(thanks|thank you|thx|appreciate (it|you)|good (bot|job|work)|nice one|love (this|it))\b/i;

export function detectIntent(text: string): Intent {
  if (WIPE_PATTERNS.test(text)) return { kind: "wipe-memory" };
  if (QUIET_PATTERNS.test(text)) return { kind: "go-quiet" };

  const addresses = extractAddressCandidates(text);
  if (addresses.length > 0) {
    if (CHART_PATTERNS.test(text)) {
      console.log(`[intent] "chart" intent for ${addresses[0]}`);
      return { kind: "chart", address: addresses[0] };
    }
    console.log(`[intent] "scan" intent for ${addresses.length} address(es): ${addresses.join(", ")}`);
    return { kind: "scan", addresses };
  }

  if (MARKET_TRIGGER.test(text)) {
    const chains = findChainMentions(text);
    if (chains.length > 0) {
      console.log(`[intent] "market" intent for ${chains[0]}`);
      return { kind: "market", chain: chains[0] };
    }
  }

  if (IDENTITY_PATTERNS.test(text)) return { kind: "identity" };
  if (GREETING_PATTERNS.test(text)) return { kind: "greeting" };
  if (APPRECIATION_PATTERNS.test(text)) return { kind: "appreciation" };

  return { kind: "chat" };
}
