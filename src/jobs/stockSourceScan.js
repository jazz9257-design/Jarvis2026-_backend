import { searchEdgarFullText } from '../adapters/edgar.js';
import { canonicalEventId } from '../leadtime.js';
import { insertSighting, startAdapterRun, finishAdapterRun } from '../ledger.js';

const DEFAULT_QUERY = '"power purchase agreement" OR interconnection OR offtake OR "backlog increased" OR "capacity expansion" OR "master supply agreement"';

function stripTags(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

function filingUrl(source, fallback) {
  const cik = firstValue(source.ciks ?? source.cik);
  const accession = source.adsh ?? source.accession_no ?? source.accessionNumber;
  if (!cik || !accession) return fallback;
  const compact = String(accession).replace(/-/g, '');
  const cikCompact = String(cik).replace(/^0+/, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikCompact}/${compact}/${accession}-index.html`;
}

function hitToSighting(hit, searchUrl) {
  const source = hit.source ?? {};
  const entity = firstValue(source.display_names) ?? source.company_name ?? source.entity_name ?? 'UNRESOLVED_ENTITY';
  const published = source.file_date ?? source.period_ending ?? null;
  const form = source.form ?? firstValue(source.root_forms) ?? 'SEC_FILING';
  const rawHighlight = firstValue(hit.highlight?.content) ?? firstValue(hit.highlight?.display_names) ?? '';
  const claim = stripTags(rawHighlight) || `${form} primary-source filing matched JARVIS low-attention precursor query for ${entity}.`;
  const eventSeed = hit.id ?? source.adsh ?? `${entity}-${published}-${form}`;
  const eventId = canonicalEventId({ lane: 'STOCK', entity, eventType: eventSeed, eventDate: published ?? 'UNKNOWN' });

  return {
    eventId,
    lane: 'STOCK',
    entity,
    tradableTicker: null,
    venue: 'EDGAR_FTS',
    venueAttention: 'LOW',
    sourceUrl: filingUrl(source, searchUrl),
    venuePublishedTs: published,
    claimText: claim,
    evidenceTier: 'PRECURSOR',
    methodologyVersion: 'LT-1.0-CODE',
    backfilled: false,
    createdBy: 'stock-edgar-adapter'
  };
}

export async function runStockSourceScan(pool, { now = new Date(), query = DEFAULT_QUERY } = {}) {
  const run = await startAdapterRun(pool, 'EDGAR_FTS');
  let itemsSeen = 0;
  let itemsNew = 0;
  try {
    const endDate = now.toISOString().slice(0, 10);
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 2);
    const startDate = start.toISOString().slice(0, 10);
    const result = await searchEdgarFullText({ query, startDate, endDate, size: 50 });
    itemsSeen = result.hits.length;

    for (const hit of result.hits) {
      const row = await insertSighting(pool, hitToSighting(hit, result.sourceUrl));
      if (row) itemsNew += 1;
    }

    await finishAdapterRun(pool, run.run_id, { status: 'SUCCESS', itemsSeen, itemsNew });
    return { adapter: 'EDGAR_FTS', itemsSeen, itemsNew };
  } catch (error) {
    await finishAdapterRun(pool, run.run_id, { status: 'FAILED', itemsSeen, itemsNew, error: error.message });
    throw error;
  }
}
