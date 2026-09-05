import { config } from "../config.js";
import { buildSystemPrompt } from "./personality.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const RETRYABLE_STATUS = new Set([429, 503]); // rate-limited or temporarily overloaded
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function askPholio(history: ChatTurn[], newUserMessage: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;

  const contents = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: newUserMessage }] },
  ];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
      if (!text) throw new Error("Gemini returned an empty response");
      return text;
    }

    const bodyText = await res.text();
    lastError = new Error(`Gemini responded ${res.status}: ${bodyText}`);

    // Only retry on transient, demand-related errors — anything else (bad key,
    // bad model name, malformed request) will fail the same way every time,
    // so retrying it would just waste time before surfacing the real problem.
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
      throw lastError;
    }

    await sleep(attempt * 1000); // 1s, then 2s, before the next attempt
  }

  // Unreachable, but keeps TypeScript satisfied that this always returns or throws.
  throw lastError ?? new Error("Gemini call failed for an unknown reason");
}
