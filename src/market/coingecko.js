const API = 'https://api.coingecko.com/api/v3';

function pctReturn(latest, prior) {
  if (![latest, prior].every(v => Number.isFinite(v) && v > 0)) return null;
  return latest / prior - 1;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function std(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function z(value, baseline) {
  const s = std(baseline);
  const m = mean(baseline);
  if (![value, s, m].every(Number.isFinite) || s === 0) return null;
  return (value - m) / s;
}

function rollingReturns(points, window) {
  const out = [];
  for (let i = window; i < points.length; i += 1) {
    const r = pctReturn(points[i].value, points[i - window].value);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

function rollingMeans(points, window) {
  const values = points.map(x => x.value).filter(Number.isFinite);
  const out = [];
  for (let i = window; i <= values.length; i += 1) out.push(mean(values.slice(i - window, i)));
  return out.filter(Number.isFinite);
}

export async function fetchCoinGeckoSnapshot(coinId, ticker, { fetchImpl = fetch } = {}) {
  const url = `${API}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=120&interval=daily`;
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const payload = await response.json();
  const prices = Array.isArray(payload?.prices) ? payload.prices.map(([ts, v]) => ({ ts, value: Number(v) })).filter(x => Number.isFinite(x.value)) : [];
  const volumes = Array.isArray(payload?.total_volumes) ? payload.total_volumes.map(([ts, v]) => ({ ts, value: Number(v) })).filter(x => Number.isFinite(x.value)) : [];
  if (prices.length < 40) throw new Error(`Insufficient CoinGecko history for ${coinId}`);

  const latest = prices.at(-1).value;
  const ret5d = prices.length >= 6 ? pctReturn(latest, prices.at(-6).value) : null;
  const ret20d = prices.length >= 21 ? pctReturn(latest, prices.at(-21).value) : null;
  const recent5 = volumes.slice(-5).map(x => x.value).filter(Number.isFinite);
  const prior90 = volumes.slice(-95, -5).map(x => x.value).filter(Number.isFinite);
  const ratio = recent5.length === 5 && prior90.length >= 60 && mean(prior90) > 0 ? mean(recent5) / mean(prior90) : null;

  const historical5dReturns = rollingReturns(prices.slice(0, -1), 5).slice(-90);
  const current5dReturnZ = z(ret5d, historical5dReturns);
  const fiveDayVolumeMeans = rollingMeans(volumes.slice(0, -5), 5).slice(-90);
  const current5dVolumeMean = mean(recent5);
  const current5dVolumeZ = z(current5dVolumeMean, fiveDayVolumeMeans);

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
    rawPayload: {
      sourceUrl: url,
      lastPricePoint: prices.at(-1),
      lastVolumePoint: volumes.at(-1),
      recognitionMetrics: {
        current5dReturnZ,
        current5dVolumeZ,
        returnBaselineObservations: historical5dReturns.length,
        volumeBaselineObservations: fiveDayVolumeMeans.length
      }
    },
    missingReason: null
  };
}
