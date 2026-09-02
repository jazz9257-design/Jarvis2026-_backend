const EFTS = 'https://efts.sec.gov/LATEST/search-index';

export async function searchEdgarFullText({ query, forms = ['8-K', 'S-1', '424B4', 'D'], startDate, endDate, size = 25, fetchImpl = fetch }) {
  if (!query) throw new Error('query required');
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error('SEC_USER_AGENT is required');

  const params = new URLSearchParams({
    q: query,
    forms: forms.join(','),
    size: String(size)
  });
  if (startDate) params.set('startdt', startDate);
  if (endDate) params.set('enddt', endDate);

  const url = `${EFTS}?${params}`;
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': userAgent,
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate'
    }
  });
  if (!response.ok) throw new Error(`SEC EFTS HTTP ${response.status}`);
  const payload = await response.json();

  const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
  return {
    sourceUrl: url,
    fetchedTs: new Date().toISOString(),
    hits: hits.map(hit => ({
      id: hit._id ?? null,
      score: hit._score ?? null,
      source: hit._source ?? {},
      highlight: hit.highlight ?? {}
    }))
  };
}
