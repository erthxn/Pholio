// Free, keyless — used to enrich a scan with live token pricing when useful.
export async function fetchTokenPrice(tokenAddress: string) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
  if (!res.ok) throw new Error(`DexScreener responded ${res.status}`);
  return res.json();
}
