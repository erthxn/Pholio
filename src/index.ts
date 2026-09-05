// Entry point: wires Photon's Spectrum iMessage provider to Pholio's logic.
// Built against Photon's confirmed Messages / Spaces & Users / Reactions &
// Replies / Attachments docs — app.messages is an async-iterable stream of
// [space, message] tuples; you narrow message.content.type and act on it
// via space.send(...) or message.reply(...).
import fs from "node:fs/promises";
import { Spectrum, text, attachment, Emoji } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { config } from "./config.js";
import { startHealthServer } from "./server.js";
import { loadProjectKnowledge } from "./ai/knowledge.js";
import { ensureSchema, ensureUser, isFirstEverMessage, saveMessage, getRecentMessages, wipeMemory, type StoredUser } from "./db.js";
import { buildWelcome, STICKERS } from "./handlers/onboarding.js";
import { detectIntent } from "./handlers/intent.js";
import { startScan, runScan } from "./handlers/scan.js";
import { buildChartOutcome } from "./handlers/chart.js";
import { findChainMentions } from "./chains/aliases.js";
import { buildInitialAsk, buildNudge, explainOffListChain, buildGiveUp } from "./handlers/chainChoicePhrasing.js";
import { sanitizeForIMessage } from "./utils/sanitize.js";
import { askPholio } from "./ai/gemini.js";
import type { ChainKey } from "./chains/types.js";

startHealthServer();
await ensureSchema();
await loadProjectKnowledge();

const app = await Spectrum({
  projectId: config.spectrum.projectId,
  projectSecret: config.spectrum.projectSecret,
  providers: [imessage.config()],
});

// Waiting-on-a-chain-choice state, keyed by our internal user id. In-memory
// is fine for a single-process deploy; move to the DB if you ever run more
// than one instance, since this won't survive a restart or be shared.
// `remaining` carries any other addresses from the same message (bug #5) so
// a multi-address request keeps going once this one chain is resolved.
// `attempts` powers bug #3's "explain once, then stop looping" behavior.
interface PendingChoice {
  address: string;
  candidates: ChainKey[];
  remaining: string[];
  attempts: number;
}
const pendingChainChoice = new Map<number, PendingChoice>();
const MAX_CHAIN_ATTEMPTS = 2;

// Per-space "go quiet" flag for the natural-language "stop replying" ask.
const quietSpaces = new Set<string>();

/** Every outgoing text bubble goes through here: sanitized, sent, then saved to history. */
// `space` is typed as `any` here rather than a hand-rolled shape: space.send
// is a real overloaded function (ContentInput | ReactionBuilder | ...), and
// a narrower `(c: unknown) => Promise<unknown>` doesn't structurally match
// that, TypeScript rejects it as a contravariant parameter mismatch.
async function sendReply(space: any, user: StoredUser, content: string): Promise<void> {
  const clean = sanitizeForIMessage(content);
  await space.send(text(clean));
  await saveMessage(user.id, "assistant", clean);
}

/**
 * Runs (or starts) a scan for each address in order (bug #5). If an address
 * needs a chain choice, this stops and waits, stashing whatever addresses
 * hadn't been processed yet in `remaining` so they pick back up once the
 * person answers.
 */
async function processScanQueue(
  space: any,
  user: StoredUser,
  addresses: string[]
): Promise<void> {
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const scanState = await startScan(address);

    if (scanState.kind === "needs-chain-choice") {
      pendingChainChoice.set(user.id, {
        address: scanState.address,
        candidates: scanState.candidates,
        remaining: addresses.slice(i + 1),
        attempts: 0,
      });
      await sendReply(space, user, buildInitialAsk(scanState.candidates));
      return;
    }

    if (scanState.kind === "unique") {
      await sendReply(space, user, `Scanning ${address} now.`);
      await space.send(attachment(STICKERS.readingData));
      const outcome = await runScan({ userId: user.id, address, chain: scanState.chain });
      if (outcome.kind === "result" && outcome.chartFilePath) {
        await space.send(attachment(outcome.chartFilePath));
        await fs.rm(outcome.chartFilePath, { force: true }).catch(() => {});
      }
      await sendReply(space, user, outcome.reply);
      continue;
    }

    // "failed" classification — didn't match any known address format
    await sendReply(space, user, scanState.reply);
  }
}

for await (const [space, message] of app.messages) {
  if (message.direction === "outbound") continue;
  if (quietSpaces.has(space.id)) continue;
  if (message.content.type !== "text") continue; // ignore non-text content for now

  const incomingText = message.content.text;
  const senderId = message.sender?.id ?? space.id; // fall back to space id if the platform can't attribute a sender
  console.log(`[message] from ${senderId} in space ${space.id}: ${incomingText}`);

  // Mark it read and drop a quick reaction so there's visible acknowledgement
  // in the thread the moment we've got the message, before any of the
  // (possibly slow) scan/chart/AI work below even starts. Both are
  // fire-and-forget and no-op silently on platforms that don't support them,
  // per Photon's Read / Reactions docs, so a failure here never blocks a
  // reply from going out.
  try {
    await message.read();
  } catch (err) {
    console.error("Error marking message read:", err);
  }
  try {
    await message.react(Emoji.like);
  } catch (err) {
    console.error("Error reacting to message:", err);
  }

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
        await space.send(text(sanitizeForIMessage(greeting)));
        await space.send(attachment(STICKERS.welcome));
        await space.send(text(sanitizeForIMessage(followUp)));
        await saveMessage(user.id, "assistant", `${greeting}\n${followUp}`);
        return;
      }

      await saveMessage(user.id, "user", incomingText);

      // Mid-way through "which chain did you mean?"
      const pending = pendingChainChoice.get(user.id);
      if (pending) {
        const mentioned = findChainMentions(incomingText);
        const chosen = pending.candidates.find((c) => mentioned.includes(c));

        if (chosen) {
          pendingChainChoice.delete(user.id);
          await sendReply(space, user, `Scanning ${pending.address} now.`);
          await space.send(attachment(STICKERS.readingData));
          const outcome = await runScan({ userId: user.id, address: pending.address, chain: chosen });
          if (outcome.kind === "result" && outcome.chartFilePath) {
            await space.send(attachment(outcome.chartFilePath));
            await fs.rm(outcome.chartFilePath, { force: true }).catch(() => {});
          }
          await sendReply(space, user, outcome.reply);
          if (pending.remaining.length > 0) {
            await processScanQueue(space, user, pending.remaining);
          }
          return;
        }

        // Bug #3: don't just loop the same question forever. Explain plainly
        // once (twice at most) and then let the conversation move on.
        const attempts = pending.attempts + 1;
        if (attempts > MAX_CHAIN_ATTEMPTS) {
          pendingChainChoice.delete(user.id);
          await sendReply(space, user, buildGiveUp(pending.candidates, attempts));
          if (pending.remaining.length > 0) {
            await processScanQueue(space, user, pending.remaining);
          }
          return;
        }

        pending.attempts = attempts;
        const otherChain = mentioned[0]; // a real chain we track, just not one of the candidates here
        const reply = otherChain
          ? explainOffListChain(otherChain, pending.candidates)
          : buildNudge(pending.candidates, attempts);
        await sendReply(space, user, reply);
        return;
      }

      const intent = detectIntent(incomingText);

      if (intent.kind === "wipe-memory") {
        await wipeMemory(user.id);
        await sendReply(space, user, "wiped, clean slate. what do you want to do?");
        return;
      }

      if (intent.kind === "go-quiet") {
        quietSpaces.add(space.id);
        await space.send(text("got it, going quiet in here."));
        return;
      }

      if (intent.kind === "scan") {
        await processScanQueue(space, user, intent.addresses);
        return;
      }

      if (intent.kind === "chart") {
        console.log(`[chart] building price chart for ${intent.address}`);
        await sendReply(space, user, `Scanning ${intent.address} now.`);
        await space.send(attachment(STICKERS.readingData));
        const outcome = await buildChartOutcome(intent.address);
        if (outcome.kind === "failed") {
          console.error(`[chart] failed for ${intent.address}: ${outcome.reply}`);
          await sendReply(space, user, outcome.reply);
          return;
        }
        console.log(`[chart] built chart for ${intent.address}`);
        await space.send(attachment(outcome.filePath));
        await sendReply(space, user, outcome.caption);
        await fs.rm(outcome.filePath, { force: true }).catch(() => {});
        return;
      }

      // Ordinary conversation — answer with recent memory as context.
      console.log(`[chat] no address/command detected, answering conversationally`);
      const history = await getRecentMessages(user.id, 20);
      const reply = await askPholio(
        history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        incomingText
      );
      await sendReply(space, user, reply);
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
