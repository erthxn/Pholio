import { fetchMarketSnapshot } from "../chains/coingecko.js";
import { askPholio } from "../ai/gemini.js";
import type { ChainKey } from "../chains/types.js";

const FLAGSHIP_CHAINS: ChainKey[] = ["bitcoin", "ethereum", "solana"];

/**
 * Casual "hi" on a return visit shouldn't sound like a generic chatbot
 * ("hey there, how are we doing today?"). Pholio stays in character, a
 * live market snapshot backs the opener so it's a real observation, not a
 * canned line, and the model phrases it fresh every time rather than
 * filling in a fixed template.
 */
export async function buildGreetingReply(): Promise<string> {
  const chain = FLAGSHIP_CHAINS[Math.floor(Math.random() * FLAGSHIP_CHAINS.length)];
  try {
    const snapshot = await fetchMarketSnapshot(chain);
    return await askPholio(
      [],
      `Someone just greeted you casually, just "hi" or similar, nothing else in
the message. You are not a generic chatbot, you're an on-chain research
agent, stay in character. Here's a real live snapshot for ${chain}:
${JSON.stringify(snapshot)}.
Reply with one short, natural message that mentions this real price move
(state whether it's up or down and by how much, using the actual 24h
change number, don't round it into something vague) and then asks what
they want to look into, an address to scan or a chain to check on. Phrase
it fresh, don't reuse a fixed template, and don't say "as an AI."`
    );
  } catch {
    // Live data failed, fall back honestly rather than stating a market
    // move with no real number behind it.
    return await askPholio(
      [],
      `Someone just greeted you casually. Reply in one short line asking what
they want to look into, an address or a chain. Stay in character as an
on-chain research agent, not a generic chatbot, and don't claim any
specific market data right now since none is available.`
    );
  }
}

/** "Who are you / what can you do" style questions, paired with the intro sticker in index.ts. */
export async function buildIdentityReply(): Promise<string> {
  return askPholio(
    [],
    `Someone asked who you are or what you can do. Explain briefly: your name
and what you do (read on-chain wallets across the chains you support and
give a plain-English trading-style read), that you're built by @erthxn on
Photon's Spectrum SDK, and that they can just paste an address, no slash
commands needed. Keep it to two or three short sentences.`
  );
}
