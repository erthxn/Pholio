import { config } from "../config.js";
import { buildSystemPrompt } from "./personality.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents,
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}
