const BASES = ['https://api.llama.fi/summary/fees', 'https://api.llama.fi/api/summary/fees'];

function normalizeChart(chart) {
  if (!Array.isArray(chart)) return [];
  return chart
    .map(row => {
      if (Array.isArray(row) && row.length >= 2) return { ts: Number(row[0]), value: Number(row[1]) };
      if (row && typeof row === 'object') {
        const ts = Number(row.timestamp ?? row.ts ?? row.date);
        const value = Number(row.value ?? row.total ?? row.dailyFees);
        return { ts, value };
      }
      return null;
    })
    .filter(x => x && Number.isFinite(x.ts) && Number.isFinite(x.value))
    .sort((a, b) => a.ts - b.ts);
}

export function extractDailySeries(payload) {
  const candidates = [
    payload?.totalDataChart,
    payload?.data?.totalDataChart,
    payload?.dailyFees,
    payload?.data?.dailyFees
  ];
  for (const candidate of candidates) {
    const series = normalizeChart(candidate);
    if (series.length) return series;
  }
  throw new Error('DefiLlama response did not contain a recognized daily series');
}

export async function fetchProtocolDailyFees(protocol, { fetchImpl = fetch } = {}) {
  let lastError;
  for (const base of BASES) {
    const url = `${base}/${encodeURIComponent(protocol)}?dataType=dailyFees`;
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const series = extractDailySeries(payload);
      return { protocol, sourceUrl: url, fetchedTs: new Date().toISOString(), payload, series };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`DefiLlama fee fetch failed: ${lastError?.message ?? 'unknown error'}`);
}
