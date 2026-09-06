import { askPholio } from "../ai/gemini.js";

// Renamed to match the actual sticker set: intro (identity + first hello),
// portfolio (available for future use, not sent automatically on a scan
// anymore, the structured report replaced that), wtf (nonsense requests).
export const STICKERS = {
  intro: "assets/intro.PNG",
  portfolio: "assets/portfolio.PNG",
  wtf: "assets/wtf.PNG",
};

/**
 * First-ever message from this person: introduce Pholio, then immediately
 * follow up asking for an address, with the intro sticker. Two messages,
 * one AI call, we ask the model for both parts at once so the voice stays
 * consistent, then send them as two separate bubbles.
 */
export async function buildWelcome(): Promise<{ greeting: string; followUp: string }> {
  const raw = await askPholio(
    [],
    `Someone just messaged you for the first time, probably just "hi" or "hello."
Reply with exactly two short lines, separated by a newline, and nothing else:
line 1: introduce yourself by name and what you do, mention you're built on Photon.
line 2: ask if they've got an address they want you to read.
No markdown, no quotation marks, no dashes, no labels like "line 1:", just the two lines.`
  );

  const [greeting, followUp] = raw.split("\n").filter(Boolean);
  return {
    greeting: greeting?.trim() ?? "hey, I'm Pholio, built on Photon to read on-chain wallets for you.",
    followUp: followUp?.trim() ?? "got an address you want me to read?",
  };
}
