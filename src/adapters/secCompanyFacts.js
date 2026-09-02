const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts';

const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'SalesRevenueNet'
];

let tickerCache = null;

function headers() {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) throw new Error('SEC_USER_AGENT is required');
  return { 'user-agent': ua, accept: 'application/json', 'accept-encoding': 'gzip, deflate' };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: headers() });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status} for ${url}`);
  return response.json();
}

export async function getSecTickerMap({ fetchImpl = fetch, forceRefresh = false } = {}) {
  if (tickerCache && !forceRefresh) return tickerCache;
  const payload = await getJson(TICKERS_URL, fetchImpl);
  const rows = Object.values(payload ?? {}).map(row => ({
    cik: String(row.cik_str).padStart(10, '0'),
    ticker: String(row.ticker ?? '').toUpperCase(),
    title: row.title ?? null
  })).filter(row => row.ticker && row.cik);
  tickerCache = new Map(rows.map(row => [row.ticker, row]));
  return tickerCache;
}

export async function tickerToCik(ticker, options = {}) {
  const map = await getSecTickerMap(options);
  const row = map.get(String(ticker).toUpperCase());
  if (!row) throw new Error(`SEC ticker map has no CIK for ${ticker}`);
  return row;
}

export function latestAnnualRevenueFromCompanyFacts(payload) {
  const usGaap = payload?.facts?.['us-gaap'] ?? {};
  for (const concept of REVENUE_CONCEPTS) {
    const entries = usGaap?.[concept]?.units?.USD;
    if (!Array.isArray(entries)) continue;
    const annual = entries
      .filter(x => x.form === '10-K' && Number.isFinite(Number(x.val)) && x.end)
      .map(x => ({ ...x, val: Number(x.val), concept }))
      .sort((a, b) => {
        const end = new Date(b.end) - new Date(a.end);
        if (end !== 0) return end;
        return new Date(b.filed ?? 0) - new Date(a.filed ?? 0);
      });
    if (annual.length) return annual[0];
  }
  return null;
}

export async function fetchLatestAnnualRevenue(ticker, { fetchImpl = fetch } = {}) {
  const issuer = await tickerToCik(ticker, { fetchImpl });
  const url = `${FACTS_BASE}/CIK${issuer.cik}.json`;
  const payload = await getJson(url, fetchImpl);
  const revenue = latestAnnualRevenueFromCompanyFacts(payload);
  if (!revenue) throw new Error(`No annual USD revenue fact found for ${ticker}`);
  return {
    ticker: issuer.ticker,
    company: issuer.title,
    cik: issuer.cik,
    revenueUsd: revenue.val,
    concept: revenue.concept,
    periodStart: revenue.start ?? null,
    periodEnd: revenue.end,
    filed: revenue.filed ?? null,
    accession: revenue.accn ?? null,
    sourceUrl: url
  };
}
