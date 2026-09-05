import type { ChainKey } from "../chains/types.js";
import { CHAIN_LABELS } from "../chains/aliases.js";

function listChains(candidates: ChainKey[]): string {
  return candidates.map((c) => CHAIN_LABELS[c]).join(", ");
}

// Rotated rather than fixed so a person who answers wrong twice in a row
// doesn't just see the identical sentence pasted back at them (bug #3).
const ASK_VARIANTS: Array<(list: string) => string> = [
  (list) => `that address is active on a few chains, ${list}. which one did you mean?`,
  (list) => `I'm seeing activity on more than one chain there, ${list}. which one you after?`,
  (list) => `a couple chains show something for that address, ${list}. pick one and I'll dig in.`,
];

const NUDGE_VARIANTS: Array<(list: string) => string> = [
  (list) => `still need to know which one, ${list}?`,
  (list) => `just to be clear, is it ${list}?`,
  (list) => `pick one of these and I'll get you the read: ${list}.`,
];

const GIVE_UP_VARIANTS: Array<(list: string) => string> = [
  (list) => `no worries, I'll leave this one for now. say the word for ${list} whenever, or drop a different address.`,
  (list) => `all good, I'll hold off on this one. ping me with ${list} if you want it later, or send another address.`,
];

/** First time we ask which chain, right after finding more than one active candidate. */
export function buildInitialAsk(candidates: ChainKey[]): string {
  return ASK_VARIANTS[0](listChains(candidates));
}

/** A generic re-ask when the reply didn't match any candidate and wasn't a recognizable chain at all. */
export function buildNudge(candidates: ChainKey[], attempt: number): string {
  const variant = NUDGE_VARIANTS[attempt % NUDGE_VARIANTS.length];
  return variant(listChains(candidates));
}

/**
 * The reply matched a real chain we track, just not one this address has
 * activity on (this is the "Robinhood" case, brand or chain, both handled
 * plainly in one shot instead of just repeating the original question).
 */
export function explainOffListChain(otherChain: ChainKey, candidates: ChainKey[]): string {
  const label = CHAIN_LABELS[otherChain];
  const list = listChains(candidates);
  const brandNote =
    otherChain === "robinhood"
      ? " and if you meant the robinhood trading app itself rather than robinhood chain, that's off platform, I only read public blockchain wallets."
      : "";
  return `I don't see activity on ${label} for this address, just ${list}.${brandNote} want one of those instead?`;
}

/** After repeated misses, stop asking the same question and let the conversation move on. */
export function buildGiveUp(candidates: ChainKey[], attempt: number): string {
  const variant = GIVE_UP_VARIANTS[attempt % GIVE_UP_VARIANTS.length];
  return variant(listChains(candidates));
}
