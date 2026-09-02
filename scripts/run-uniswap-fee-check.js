import { fetchProtocolDailyFees } from '../src/adapters/defillama.js';
import { sevenDayAnomalyVsPrior90 } from '../src/leadtime.js';

const result = await fetchProtocolDailyFees('uniswap');
const values = result.series.map(x => x.value);
const anomaly = sevenDayAnomalyVsPrior90(values);

console.log(JSON.stringify({
  protocol: result.protocol,
  sourceUrl: result.sourceUrl,
  fetchedTs: result.fetchedTs,
  observations: result.series.length,
  firstObservation: result.series[0] ?? null,
  lastObservation: result.series.at(-1) ?? null,
  anomaly
}, null, 2));
