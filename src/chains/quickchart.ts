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
