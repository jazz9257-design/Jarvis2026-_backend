const API = 'https://api.tiingo.com';

function requiredKey() {
  const key = process.env.TIINGO_API_KEY;
  if (!key) throw new Error('TIINGO_API_KEY is required for live market snapshots');
  return key;
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Tiingo HTTP ${response.status}`);
  return response.json();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

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

function rollingReturns(rows, window) {
  const out = [];
  for (let i = window; i < rows.length; i += 1) {
    const r = pctReturn(rows[i].close, rows[i - window].close);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

function rollingVolumeMeans(rows, window) {
  const out = [];
  for (let i = window; i <= rows.length; i += 1) {
    const m = mean(rows.slice(i - window, i).map(r => r.volume));
    if (Number.isFinite(m)) out.push(m);
  }
  return out;
}

export async function fetchTiingoStockSnapshot(ticker, { fetchImpl = fetch, now = new Date() } = {}) {
  const key = requiredKey();
  const symbol = ticker.toUpperCase();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 180);

  const historyUrl = `${API}/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${isoDate(start)}&endDate=${isoDate(now)}&resampleFreq=daily&token=${encodeURIComponent(key)}`;
  const iexUrl = `${API}/iex/${encodeURIComponent(symbol)}?token=${encodeURIComponent(key)}`;

  const [history, iex] = await Promise.all([
    getJson(historyUrl, fetchImpl),
    getJson(iexUrl, fetchImpl).catch(() => [])
  ]);

  if (!Array.isArray(history) || history.length < 40) throw new Error(`Insufficient Tiingo history for ${symbol}`);
  const rows = history
    .map(row => ({
      date: row.date,
      close: Number(row.adjClose ?? row.close),
      volume: Number(row.adjVolume ?? row.volume)
    }))
    .filter(row => Number.isFinite(row.close) && Number.isFinite(row.volume))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const latestHistory = rows.at(-1);
  const iexRow = Array.isArray(iex) ? iex[0] : null;
  const livePrice = Number(iexRow?.tngoLast ?? iexRow?.last ?? iexRow?.prevClose);
  const price = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : latestHistory.close;

  const ret5d = rows.length >= 6 ? pctReturn(price, rows.at(-6).close) : null;
  const ret20d = rows.length >= 21 ? pctReturn(price, rows.at(-21).close) : null;

  const recent5 = rows.slice(-5).map(r => r.volume);
  const prior90 = rows.slice(-95, -5).map(r => r.volume);
  const volumeRatio = recent5.length === 5 && prior90.length >= 60 && mean(prior90) > 0
    ? mean(recent5) / mean(prior90)
    : null;

  const historical5dReturns = rollingReturns(rows.slice(0, -1), 5).slice(-90);
  const current5dReturnZ = z(ret5d, historical5dReturns);
  const fiveDayVolumeMeans = rollingVolumeMeans(rows.slice(0, -5), 5).slice(-90);
  const current5dVolumeZ = z(mean(recent5), fiveDayVolumeMeans);

  return {
    ticker: symbol,
    capturedTs: new Date().toISOString(),
    sourceName: 'Tiingo',
    sourceKind: 'API',
    status: [price, ret5d, ret20d, volumeRatio].every(Number.isFinite) ? 'FULL' : 'PARTIAL',
    price,
    ret5d,
    ret20d,
    volumeRatio5d90d: volumeRatio,
    rawPayload: {
      latestHistory,
      iex: iexRow ?? null,
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
