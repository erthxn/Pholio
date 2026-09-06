/**
 * iMessage can't render a live chart from text, so a "chart" request means
 * turning real price data into an actual image and sending it as an
 * attachment. QuickChart.io takes a Chart.js config as a URL param and
 * returns a PNG, no server-side chart library needed.
 *
 * DexScreener's free API doesn't expose historical OHLC candles, so rather
 * than fabricate candlesticks we chart the real price-change percentages it
 * does give us across 5m/1h/6h/24h windows. Honest data, real chart image.
 */
export interface ChangePoint {
  label: string;
  value: number;
}

export function buildMomentumChartUrl(params: { symbol: string; changes: ChangePoint[] }): string {
  const config = {
    type: "bar",
    data: {
      labels: params.changes.map((c) => c.label),
      datasets: [
        {
          label: `${params.symbol} price change %`,
          data: params.changes.map((c) => c.value),
          backgroundColor: params.changes.map((c) => (c.value >= 0 ? "#16c784" : "#ea3943")),
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${params.symbol} price change` },
      },
    },
  };

  return `https://quickchart.io/chart?w=600&h=350&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * Chart for "give me a chart" on a wallet scan, not just a token contract.
 * Only ever fed holdings that already came back with a real USD price from
 * the chain API (see extractTonJettonHoldings in tonapi.ts) — nothing here
 * estimates a price, it just visualizes numbers that are already real.
 */
export interface HoldingPoint {
  label: string;
  usdValue: number;
}

export function buildHoldingsChartUrl(params: { title: string; holdings: HoldingPoint[] }): string {
  const config = {
    type: "bar",
    data: {
      labels: params.holdings.map((h) => h.label),
      datasets: [
        {
          label: "USD value",
          data: params.holdings.map((h) => Number(h.usdValue.toFixed(2))),
          backgroundColor: "#3b82f6",
        },
      ],
    },
    options: {
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        title: { display: true, text: params.title },
      },
    },
  };

  return `https://quickchart.io/chart?w=600&h=400&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * Portfolio composition pie, native asset vs. stablecoins vs. everything
 * else. Fed only by categories that actually have a real priced USD value
 * (see portfolioMix.ts), a category with nothing priced in it is just
 * omitted rather than shown as zero.
 */
export interface MixSlice {
  label: string;
  usdValue: number;
}

export function buildPortfolioMixChartUrl(params: { title: string; slices: MixSlice[] }): string {
  const config = {
    type: "pie",
    data: {
      labels: params.slices.map((s) => s.label),
      datasets: [
        {
          data: params.slices.map((s) => Number(s.usdValue.toFixed(2))),
          backgroundColor: ["#3b82f6", "#16c784", "#f59e0b", "#a855f7", "#ea3943"],
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: params.title },
      },
    },
  };

  return `https://quickchart.io/chart?w=500&h=500&bkg=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

/** A real 24h price line for a chain-level "what's happening in X" question. */
export interface PricePoint {
  x: number;
  y: number;
}

export function buildPriceLineChartUrl(params: { label: string; points: PricePoint[] }): string {
  const config = {
    type: "line",
    data: {
      datasets: [
        {
          label: `${params.label} price (USD)`,
          data: params.points,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.15)",
          fill: true,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    },
    options: {
      scales: {
        x: { type: "time", time: { unit: "hour" } },
      },
      plugins: {
        title: { display: true, text: `${params.label}, last 24h` },
      },
    },
  };

  return `https://quickchart.io/chart?w=600&h=350&bkg=white&version=3&c=${encodeURIComponent(JSON.stringify(config))}`;
}
