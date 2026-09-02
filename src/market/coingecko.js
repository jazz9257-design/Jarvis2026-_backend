const API = 'https://api.coingecko.com/api/v3';

function pctReturn(latest, prior) {
  if (![latest, prior].every(v => Number.isFinite(v) && v > 0)) return null;
  return latest / prior - 1;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function fetchCoinGeckoSnapshot(coinId, ticker, { fetchImpl = fetch } = {}) {
  const url = `${API}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=100&interval=daily`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const payload = await response.json();
  const prices = Array.isArray(payload?.prices) ? payload.prices.map(([ts, v]) => ({ ts, value: Number(v) })) : [];
  const volumes = Array.isArray(payload?.total_volumes) ? payload.total_volumes.map(([ts, v]) => ({ ts, value: Number(v) })) : [];
  if (prices.length < 21) throw new Error(`Insufficient CoinGecko history for ${coinId}`);

  const latest = prices.at(-1).value;
  const ret5d = prices.length >= 6 ? pctReturn(latest, prices.at(-6).value) : null;
  const ret20d = prices.length >= 21 ? pctReturn(latest, prices.at(-21).value) : null;
  const recent5 = volumes.slice(-5).map(x => x.value).filter(Number.isFinite);
  const prior90 = volumes.slice(-95, -5).map(x => x.value).filter(Number.isFinite);
  const ratio = recent5.length === 5 && prior90.length >= 60 && mean(prior90) > 0 ? mean(recent5) / mean(prior90) : null;

  return {
    ticker: ticker.toUpperCase(),
    capturedTs: new Date().toISOString(),
    sourceName: 'CoinGecko',
    sourceKind: 'API',
    status: [latest, ret5d, ret20d, ratio].every(Number.isFinite) ? 'FULL' : 'PARTIAL',
    price: latest,
    ret5d,
    ret20d,
    volumeRatio5d90d: ratio,
    rawPayload: { sourceUrl: url, lastPricePoint: prices.at(-1), lastVolumePoint: volumes.at(-1) },
    missingReason: null
  };
}
