import crypto from 'node:crypto';

export function claimHash(text) {
  if (!text || !String(text).trim()) throw new Error('claim text required');
  return crypto.createHash('sha256').update(String(text).trim()).digest('hex');
}

export function makeSighting({
  entity,
  tradable_ticker = null,
  venue,
  venue_url,
  venue_published_ts = null,
  claim_text,
  lane = 'STOCK',
  venue_attention = 'LOW',
  evidence_tier = 'PRECURSOR',
  methodology_version = 'LT-1.0'
}) {
  for (const [name, value] of Object.entries({ entity, venue, venue_url, claim_text })) {
    if (!value || !String(value).trim()) throw new Error(`${name} required`);
  }
  return {
    event_id: crypto.randomUUID(),
    lane,
    entity: String(entity).trim(),
    tradable_ticker: tradable_ticker ? String(tradable_ticker).trim().toUpperCase() : null,
    venue: String(venue).trim(),
    venue_attention,
    source_url: String(venue_url).trim(),
    venue_url: String(venue_url).trim(),
    venue_published_ts,
    claim_text: String(claim_text).trim(),
    claim_hash: claimHash(claim_text),
    evidence_tier,
    methodology_version,
    backfilled: false
  };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function sampleStd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1));
}
function rollingMeans(values, window) {
  const out = [];
  for (let i = window; i <= values.length; i += 1) out.push(mean(values.slice(i - window, i)));
  return out;
}

export function zAnomaly(dailyValues, { window = 7, baseline = 90, threshold = 2 } = {}) {
  if (!Array.isArray(dailyValues)) throw new Error('dailyValues must be an array');
  const need = window + baseline;
  if (dailyValues.length < need) return { valid: false, anomaly: false, reason: `NEED_${need}_DAILY_OBSERVATIONS`, observations: dailyValues.length };
  const values = dailyValues.map(Number);
  if (!values.every(Number.isFinite)) throw new Error('dailyValues must contain only finite numbers');
  const current = values.slice(-window);
  const prior = values.slice(-need, -window);
  const baselineMeans = rollingMeans(prior, window);
  const currentMean = mean(current);
  const baselineMean = mean(baselineMeans);
  const baselineStd = sampleStd(baselineMeans);
  if (!Number.isFinite(baselineStd) || baselineStd === 0) {
    return { valid: false, anomaly: false, reason: 'ZERO_BASELINE_VARIANCE', observations: values.length, currentMean, baselineMean };
  }
  const z = (currentMean - baselineMean) / baselineStd;
  return { valid: true, anomaly: z >= threshold, observations: values.length, window, baseline, currentMean, baselineMean, baselineStd, z, threshold };
}
