// Entry point: wires Photon's Spectrum iMessage provider to Pholio's logic.
// Built against Photon's confirmed Messages / Spaces & Users / Reactions &
// Replies / Attachments docs — app.messages is an async-iterable stream of
// [space, message] tuples; you narrow message.content.type and act on it
// via space.send(...) or message.reply(...).
import { Spectrum, text, attachment } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { config } from "./config.js";
import { startHealthServer } from "./server.js";
import { loadProjectKnowledge } from "./ai/knowledge.js";
import { ensureUser, isFirstEverMessage, saveMessage, getRecentMessages, wipeMemory, type StoredUser } from "./db.js";
import { buildWelcome, STICKERS } from "./handlers/onboarding.js";
import { detectIntent } from "./handlers/intent.js";
import { startScan, runScan } from "./handlers/scan.js";
import { askPholio } from "./ai/gemini.js";
import type { ChainKey } from "./chains/types.js";

startHealthServer();
await loadProjectKnowledge();

const app = await Spectrum({
  projectId: config.spectrum.projectId,
  projectSecret: config.spectrum.projectSecret,
  providers: [imessage.config()],
});


// Waiting-on-a-chain-choice state, keyed by our internal user id. In-memory
// is fine for a single-process deploy; move to the DB if you ever run more
// than one instance, since this won't survive a restart or be shared.
const pendingChainChoice = new Map<number, { address: string; candidates: ChainKey[] }>();

// Per-space "go quiet" flag for the natural-language "stop replying" ask.
const quietSpaces = new Set<string>();

for await (const [space, message] of app.messages) {
  if (message.direction === "outbound") continue;
  if (quietSpaces.has(space.id)) continue;
  if (message.content.type !== "text") continue; // ignore non-text content for now

  const incomingText = message.content.text;
  const senderId = message.sender?.id ?? space.id; // fall back to space id if the platform can't attribute a sender

  let user: StoredUser;
  let firstTime: boolean;
  try {
    user = await ensureUser(senderId);
    firstTime = await isFirstEverMessage(senderId);
  } catch (err) {
    console.error("Error resolving user:", err);
    try {
      await space.send(text("hit a snag on my end, try that again in a moment."));
    } catch {
      // nothing more to do if even this fails
    }
    continue;
  }

  await space.responding(async () => {
    try {
      if (firstTime) {
        const { greeting, followUp } = await buildWelcome();
        await space.send(text(greeting));
        await space.send(attachment(STICKERS.welcome));
        await space.send(text(followUp));
        await saveMessage(user.id, "assistant", `${greeting}\n${followUp}`);
        return;
      }

      await saveMessage(user.id, "user", incomingText);

      // Mid-way through "which chain did you mean?"
      const pending = pendingChainChoice.get(user.id);
      if (pending) {
        const chosen = pending.candidates.find((c) => incomingText.toLowerCase().includes(c));
        if (chosen) {
          pendingChainChoice.delete(user.id);
          await space.send(attachment(STICKERS.readingData));
          const outcome = await runScan({ userId: user.id, address: pending.address, chain: chosen });
          await space.send(text(outcome.reply));
          await saveMessage(user.id, "assistant", outcome.reply);
          return;
        }
        const nudge = `which one did you mean — ${pending.candidates.join(", ")}?`;
        await space.send(text(nudge));
        await saveMessage(user.id, "assistant", nudge);
        return;
      }

      const intent = detectIntent(incomingText);

      if (intent.kind === "wipe-memory") {
        await wipeMemory(user.id);
        const reply = "wiped — clean slate. what do you want to do?";
        await space.send(text(reply));
        await saveMessage(user.id, "assistant", reply);
        return;
      }

      if (intent.kind === "go-quiet") {
        quietSpaces.add(space.id);
        await space.send(text("got it, going quiet in here."));
        return;
      }

      if (intent.kind === "scan") {
        const scanState = await startScan(intent.address);

        if (scanState.kind === "needs-chain-choice") {
          pendingChainChoice.set(user.id, { address: scanState.address, candidates: scanState.candidates });
          const ask = `that address is active on a few chains — ${scanState.candidates.join(", ")}. which one did you mean?`;
          await space.send(text(ask));
          await saveMessage(user.id, "assistant", ask);
          return;
        }

        if (scanState.kind === "unique") {
          await space.send(attachment(STICKERS.readingData));
          const outcome = await runScan({ userId: user.id, address: intent.address, chain: scanState.chain });
          await space.send(text(outcome.reply));
          await saveMessage(user.id, "assistant", outcome.reply);
          return;
        }

        // "failed" classification — didn't match any known address format
        await space.send(text(scanState.reply));
        await saveMessage(user.id, "assistant", scanState.reply);
        return;
      }

      // Ordinary conversation — answer with recent memory as context.
      const history = await getRecentMessages(user.id, 20);
      const reply = await askPholio(
        history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        incomingText
      );
      await space.send(text(reply));
      await saveMessage(user.id, "assistant", reply);
    } catch (err) {
      // A failure here used to crash the whole process, taking down every
      // other conversation with it. Log it, tell this user plainly, and
      // keep the process alive for everyone else.
      console.error("Error handling message:", err);
      try {
        await space.send(text("hit a snag on my end, try that again in a moment."));
      } catch {
        // If even sending the error message fails, there's nothing more to do here.
      }
    }
  });
}
