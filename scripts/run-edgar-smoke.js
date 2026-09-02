import { searchEdgarFullText } from '../src/adapters/edgar.js';

const query = process.argv.slice(2).join(' ') || '"power purchase agreement" OR interconnection OR offtake OR "capacity expansion" OR "master supply agreement"';
const today = new Date();
const endDate = today.toISOString().slice(0, 10);
const start = new Date(today);
start.setUTCDate(start.getUTCDate() - 14);
const startDate = start.toISOString().slice(0, 10);

const result = await searchEdgarFullText({ query, startDate, endDate, size: 10 });
console.log(JSON.stringify({
  sourceUrl: result.sourceUrl,
  fetchedTs: result.fetchedTs,
  hitCount: result.hits.length,
  hits: result.hits
}, null, 2));
