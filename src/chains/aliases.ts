import type { ChainKey } from "./types.js";

/**
 * Bug #2 fix: chain names were only ever recognized by address format, so
 * plain-English chain names ("ETH", "Ethereums", "SOL", "base") never
 * resolved to anything. This table plus fuzzy matching below is the single
 * place that understands those names, so both the "which chain did you
 * mean" flow and any future bare "what's happening on SOL" style question
 * can share the exact same logic instead of drifting apart.
 */
const CHAIN_ALIASES: Record<string, ChainKey> = {
  eth: "ethereum",
  ether: "ethereum",
  ethereum: "ethereum",
  ethereums: "ethereum",
  ethereun: "ethereum",

  base: "base",
  basechain: "base",

  polygon: "polygon",
  matic: "polygon",

  robinhood: "robinhood",
  robinhoodchain: "robinhood",

  hyperevm: "hyperevm",
  hyperliquid: "hyperevm",
  hyper: "hyperevm",

  sol: "solana",
  solana: "solana",

  ton: "ton",
  toncoin: "ton",
  tonchain: "ton",
  // GRAM is not a separate token, it's TON's native coin under a different
  // name (see personality.ts / tonapi.ts notes) — aliasing it here means a
  // bare "what about my gram" resolves to the ton chain instead of coming
  // back empty, and the prompt-level rule stops it turning into a made-up
  // balance.
  gram: "ton",

  btc: "bitcoin",
  bitcoin: "bitcoin",

  sui: "sui",
};

export const CHAIN_LABELS: Record<ChainKey, string> = {
  ethereum: "ethereum",
  base: "base",
  polygon: "polygon",
  robinhood: "robinhood chain",
  hyperevm: "hyperevm",
  solana: "solana",
  ton: "ton",
  bitcoin: "bitcoin",
  sui: "sui",
};

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Classic edit distance, small inputs only (chain names/aliases are short words). */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Matches a single word against the alias table, tolerating small typos
 * ("ertheureum", "ethereun") without matching things that just aren't close
 * to any chain name.
 */
export function matchChainWord(word: string): ChainKey | null {
  const norm = normalize(word);
  if (!norm) return null;

  const exact = CHAIN_ALIASES[norm];
  if (exact) return exact;

  let best: { chain: ChainKey; dist: number } | null = null;
  for (const [alias, chain] of Object.entries(CHAIN_ALIASES)) {
    const dist = levenshtein(norm, alias);
    const threshold = alias.length <= 4 ? 1 : 2; // stricter tolerance for short aliases like "sol", "eth"
    if (dist <= threshold && (!best || dist < best.dist)) {
      best = { chain, dist };
    }
  }
  return best?.chain ?? null;
}

/**
 * Scans free text word-by-word for anything that looks like a chain
 * mention, alias or typo included. Returns every distinct chain found, in
 * first-seen order — used both to resolve "which chain did you mean"
 * answers and, later, bare "what's happening in X" questions.
 */
export function findChainMentions(text: string): ChainKey[] {
  const words = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const found: ChainKey[] = [];
  const seen = new Set<ChainKey>();
  for (const word of words) {
    const match = matchChainWord(word);
    if (match && !seen.has(match)) {
      seen.add(match);
      found.push(match);
    }
  }
  return found;
}
