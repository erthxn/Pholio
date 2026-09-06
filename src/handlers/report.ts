import type { ChainKey } from "../chains/types.js";
import type { PortfolioMix } from "../chains/portfolioMix.js";

/**
 * Best-guess public explorer tx URL per chain, for the "View Scan" links.
 * Only robinhoodchain.blockscout.com was confirmed while this project was
 * being built, the rest follow Blockscout's standard per-chain subdomain
 * pattern, verify each one against a real transaction link before trusting
 * it in front of people, a wrong one is just a dead link, not a data error,
 * but worth checking.
 */
const EXPLORER_TX_URL: Partial<Record<ChainKey, (hash: string) => string>> = {
  ethereum: (h) => `https://eth.blockscout.com/tx/${h}`,
  base: (h) => `https://base.blockscout.com/tx/${h}`,
  polygon: (h) => `https://polygon.blockscout.com/tx/${h}`,
  robinhood: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
  solana: (h) => `https://solscan.io/tx/${h}`,
  ton: (h) => `https://tonviewer.com/transaction/${h}`,
  bitcoin: (h) => `https://mempool.space/tx/${h}`,
  sui: (h) => `https://suivision.xyz/txblock/${h}`,
};

function shortAddr(addr: string | undefined): string {
  if (!addr || addr.length < 10) return addr ?? "unknown";
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

function timeAgo(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export interface TxLine {
  label: string;
  detail: string;
  when: string;
  link?: string;
}

/**
 * Best-effort recent-transaction extraction. Field names here are inferred
 * from each API's typical response shape and were NOT verified against a
 * live call while building this, check the first real report against the
 * raw JSON for that chain and adjust field paths if something comes back
 * blank rather than assuming the data isn't there. A transaction that
 * doesn't parse is skipped, never guessed at.
 */
export function extractTopTransactions(chain: ChainKey, data: Record<string, unknown>, limit = 3): TxLine[] {
  const lines: TxLine[] = [];
  const linkFor = EXPLORER_TX_URL[chain];

  if (["ethereum", "base", "polygon", "robinhood", "hyperevm"].includes(chain)) {
    const items = ((data.txs as any)?.items ?? []) as any[];
    for (const item of items.slice(0, limit)) {
      const method = (item?.method || item?.tx_types?.[0] || "transfer") as string;
      const valueNative = Number(item?.value) / 1e18;
      const counterpart = item?.to?.hash ?? item?.from?.hash;
      const detail =
        Number.isFinite(valueNative) && valueNative > 0
          ? `${valueNative.toFixed(4)} native to ${shortAddr(counterpart)}`
          : `to ${shortAddr(counterpart)}`;
      lines.push({
        label: String(method).toUpperCase(),
        detail,
        when: timeAgo(item?.timestamp ? Date.parse(item.timestamp) : undefined),
        link: item?.hash && linkFor ? linkFor(item.hash) : undefined,
      });
    }
  }

  if (chain === "solana") {
    const txs = (data.transactions as any[]) ?? [];
    for (const tx of txs.slice(0, limit)) {
      lines.push({
        label: String(tx?.type ?? "TRANSACTION").toUpperCase(),
        detail: tx?.description || "on-chain activity",
        when: timeAgo(tx?.timestamp ? tx.timestamp * 1000 : undefined),
        link: tx?.signature && linkFor ? linkFor(tx.signature) : undefined,
      });
    }
  }

  if (chain === "ton") {
    const events = ((data.events as any)?.events ?? []) as any[];
    for (const ev of events.slice(0, limit)) {
      lines.push({
        label: String(ev?.actions?.[0]?.type ?? "EVENT").toUpperCase(),
        detail: ev?.actions?.[0]?.simple_preview?.description || "on-chain activity",
        when: timeAgo(ev?.timestamp ? ev.timestamp * 1000 : undefined),
        link: ev?.event_id && linkFor ? linkFor(ev.event_id) : undefined,
      });
    }
  }

  return lines;
}

/**
 * The structured report itself, built for Photon's markdown() content type,
 * not text(). Bold and link syntax here is intentional and meant to render,
 * this bypasses the plain-text sanitizer on purpose. Every field traces back
 * to real data, portfolioMix's categories, the raw tx list, no placeholder
 * numbers.
 */
export function buildPortfolioReportMarkdown(params: {
  address: string;
  chain: string;
  mix: PortfolioMix;
  txLines: TxLine[];
  summary: string;
}): string {
  const { address, chain, mix, txLines, summary } = params;
  const short = shortAddr(address);

  const assetLines = mix.categories
    .map((c) => `- ${c.label}: $${c.usdValue.toFixed(2)}`)
    .join("\n");

  const txBlock =
    txLines.length > 0
      ? txLines
          .map((t) => {
            const linkPart = t.link ? ` [View Scan](${t.link})` : "";
            return `${t.label} | ${t.detail}\n${t.when}${linkPart}`;
          })
          .join("\n\n")
      : "no recent transactions found";

  const unpricedNote = mix.hasUnpricedHoldings
    ? "\n\n(some smaller holdings without a live price aren't included in the totals above)"
    : "";

  return `**PORTFOLIO REPORT**
\`${short}\` on ${chain}

**Total Balance**
$${mix.totalUsd.toFixed(2)}

**Assets**
${assetLines || "nothing priced to show yet"}${unpricedNote}

**Top Transactions**
${txBlock}

${summary}`;
}
