// Entry point: wires Photon's Spectrum iMessage provider to Pholio's logic.
import fs from "node:fs/promises";
import path from "node:path";
import { Spectrum, text, markdown, attachment } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { config } from "./config.js";
import { startHealthServer } from "./server.js";
import { loadProjectKnowledge } from "./ai/knowledge.js";
import { ensureSchema, ensureUser, isFirstEverMessage, saveMessage, getRecentMessages, wipeMemory, type StoredUser } from "./db.js";
import { buildWelcome, STICKERS } from "./handlers/onboarding.js";
import { buildGreetingReply, buildIdentityReply } from "./handlers/persona.js";
import { detectIntent } from "./handlers/intent.js";
import { startScan, runScan, type ScanOutcome } from "./handlers/scan.js";
import { buildChartOutcome } from "./handlers/chart.js";
import { buildMarketOutcome } from "./handlers/market.js";
import { buildPortfolioMix } from "./chains/portfolioMix.js";
import { buildPortfolioMixChartUrl } from "./chains/quickchart.js";
import { extractTopTransactions, buildPortfolioReportMarkdown } from "./handlers/report.js";
import { findChainMentions, CHAIN_LABELS } from "./chains/aliases.js";
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

interface PendingChoice {
  address: string;
  candidates: ChainKey[];
  remaining: string[];
  attempts: number;
}
const pendingChainChoice = new Map<number, PendingChoice>();
const MAX_CHAIN_ATTEMPTS = 2;

const quietSpaces = new Set<string>();

const APPRECIATION_REPLIES = ["anytime.", "you got it.", "always down to dig into a wallet.", "glad it helped."];
function pick<T>(options: T[]): T {
  return options[Math.floor(Math.random() * options.length)];
}

/** Plain conversational text: sanitized against stray markdown/dashes, sent, then saved to history. */
async function sendReply(space: any, user: StoredUser, content: string): Promise<void> {
  const clean = sanitizeForIMessage(content);
  await space.send(text(clean));
  await saveMessage(user.id, "assistant", clean);
}

/**
 * The structured portfolio report is sent as real styled iMessage content
 * (bold, monospace, tappable links), so it deliberately bypasses the plain
 * text sanitizer, that sanitizer exists to strip exactly the symbols this
 * message needs in order to render correctly.
 */
async function sendMarkdownReply(space: any, user: StoredUser, content: string): Promise<void> {
  await space.send(markdown(content));
  await saveMessage(user.id, "assistant", content);
}

async function sendChartFile(space: any, filePath: string): Promise<void> {
  await space.send(attachment(filePath));
  await fs.rm(filePath, { force: true }).catch(() => {});
}

/** Fetches a QuickChart URL to a temp PNG file, same pattern used by every chart in this project. */
async function downloadChart(url: string, prefix: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[chart] QuickChart responded ${res.status} for ${prefix}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const filePath = path.join("/tmp", `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fs.writeFile(filePath, buf);
    return filePath;
  } catch (err) {
    console.error(`[chart] failed to download chart for ${prefix}`, err);
    return null;
  }
}

/**
 * The 3-message portfolio result: a composition pie chart (native vs.
 * stablecoins vs. other, only for whatever was actually priced), then the
 * structured report (bold sections, tappable "View Scan" links, closing
 * with the plain-English read). No sticker, the chart and report carry the
 * visual weight now.
 */
async function presentScanResult(space: any, user: StoredUser, address: string, outcome: Extract<ScanOutcome, { kind: "result" }>): Promise<void> {
  const mix = await buildPortfolioMix(outcome.chain, outcome.raw);

  if (mix.categories.length > 0) {
    const chartUrl = buildPortfolioMixChartUrl({ title: `${address} composition`, slices: mix.categories });
    const filePath = await downloadChart(chartUrl, "portfolio-mix");
    if (filePath) await sendChartFile(space, filePath);
  }

  const txLines = extractTopTransactions(outcome.chain, outcome.raw);
  const report = buildPortfolioReportMarkdown({
    address,
    chain: CHAIN_LABELS[outcome.chain],
    mix,
    txLines,
    summary: outcome.reply,
  });
  await sendMarkdownReply(space, user, report);
}

/**
 * Runs (or starts) a scan for each address in order. If an address needs a
 * chain choice, this stops and waits, stashing whatever addresses hadn't
 * been processed yet in `remaining` so they pick back up once the person answers.
 */
async function processScanQueue(space: any, user: StoredUser, addresses: string[]): Promise<void> {
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
      await sendReply(space, user, `sit tight, reading ${address}.`);
      const outcome = await runScan({ userId: user.id, address, chain: scanState.chain });
      if (outcome.kind === "result") {
        await presentScanResult(space, user, address, outcome);
      } else {
        await sendReply(space, user, outcome.reply);
      }
      continue;
    }

    await sendReply(space, user, scanState.reply);
  }
}

for await (const [space, message] of app.messages) {
  if (message.direction === "outbound") continue;
  if (quietSpaces.has(space.id)) continue;
  if (message.content.type !== "text") continue;

  const incomingText = message.content.text;
  const senderId = message.sender?.id ?? space.id;
  console.log(`[message] from ${senderId} in space ${space.id}: ${incomingText}`);

  try {
    await message.read();
  } catch (err) {
    console.error("Error marking message read:", err);
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
        await space.send(attachment(STICKERS.intro));
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
          try {
            await message.react("📑");
          } catch (err) {
            console.error("Error reacting to message:", err);
          }
          await sendReply(space, user, `sit tight, reading ${pending.address}.`);
          const outcome = await runScan({ userId: user.id, address: pending.address, chain: chosen });
          if (outcome.kind === "result") {
            await presentScanResult(space, user, pending.address, outcome);
          } else {
            await sendReply(space, user, outcome.reply);
          }
          if (pending.remaining.length > 0) {
            await processScanQueue(space, user, pending.remaining);
          }
          return;
        }

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
        const otherChain = mentioned[0];
        const reply = otherChain
          ? explainOffListChain(otherChain, pending.candidates)
          : buildNudge(pending.candidates, attempts);
        await sendReply(space, user, reply);
        return;
      }

      const intent = detectIntent(incomingText);

      // Reactions are deliberately scoped to specific intents, not fired on
      // every message, a request to scan a portfolio gets 📑, a request for
      // live market info gets ⏳, appreciation gets ❤️, everything else gets
      // no reaction at all.
      try {
        if (intent.kind === "scan") await message.react("📑");
        else if (intent.kind === "chart" || intent.kind === "market") await message.react("⏳");
        else if (intent.kind === "appreciation") await message.react("❤️");
      } catch (err) {
        console.error("Error reacting to message:", err);
      }

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

      if (intent.kind === "appreciation") {
        await sendReply(space, user, pick(APPRECIATION_REPLIES));
        return;
      }

      if (intent.kind === "identity") {
        const reply = await buildIdentityReply();
        await space.send(attachment(STICKERS.intro));
        await sendReply(space, user, reply);
        return;
      }

      if (intent.kind === "greeting") {
        const reply = await buildGreetingReply();
        await sendReply(space, user, reply);
        return;
      }

      if (intent.kind === "scan") {
        await processScanQueue(space, user, intent.addresses);
        return;
      }

      if (intent.kind === "chart") {
        console.log(`[chart] building price chart for ${intent.address}`);
        const outcome = await buildChartOutcome(intent.address);
        if (outcome.kind === "failed") {
          console.error(`[chart] failed for ${intent.address}: ${outcome.reply}`);
          await sendReply(space, user, outcome.reply);
          return;
        }
        console.log(`[chart] built chart for ${intent.address}`);
        await sendChartFile(space, outcome.filePath);
        await sendReply(space, user, outcome.caption);
        return;
      }

      if (intent.kind === "market") {
        console.log(`[market] building market snapshot for ${intent.chain}`);
        const outcome = await buildMarketOutcome(intent.chain);
        if (outcome.kind === "failed") {
          await sendReply(space, user, outcome.reply);
          return;
        }
        await sendChartFile(space, outcome.filePath);
        await sendReply(space, user, outcome.caption);
        return;
      }

      // Ordinary conversation, answer with recent memory as context. A
      // genuinely absurd/impossible ask comes back prefixed with a hidden
      // "[WTF]" marker (see personality.ts), stripped here and swapped for
      // the wtf sticker instead of shown to the person.
      console.log(`[chat] no address/command detected, answering conversationally`);
      const history = await getRecentMessages(user.id, 20);
      let reply = await askPholio(
        history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        incomingText
      );

      const isWtf = reply.startsWith("[WTF]");
      if (isWtf) {
        reply = reply.replace(/^\[WTF\]\s*/, "");
        await space.send(attachment(STICKERS.wtf));
      }
      await sendReply(space, user, reply);
    } catch (err) {
      console.error("Error handling message:", err);
      try {
        await space.send(text("hit a snag on my end, try that again in a moment."));
      } catch {
        // nothing more to do if even this fails
      }
    }
  });
}
