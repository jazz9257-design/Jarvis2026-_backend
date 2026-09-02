import crypto from 'node:crypto';

export function claimHash(text) {
  if (!text || !text.trim()) throw new Error('claim text required');
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

export function canonicalEventId({ lane, entity, eventType, eventDate }) {
  const raw = [lane, entity, eventType, eventDate].map(v => String(v ?? '').trim().toUpperCase()).join('|');
  if (raw.includes('||')) throw new Error('lane, entity, eventType and eventDate are required');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('values required');
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sampleStd(values) {
  if (!Array.isArray(values) || values.length < 2) throw new Error('at least two values required');
  const m = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function rollingMeans(values, window) {
  if (!Number.isInteger(window) || window < 1) throw new Error('window must be a positive integer');
  if (values.length < window) return [];
  const out = [];
  let sum = values.slice(0, window).reduce((a, b) => a + b, 0);
  out.push(sum / window);
  for (let i = window; i < values.length; i += 1) {
    sum += values[i] - values[i - window];
    out.push(sum / window);
  }
  return out;
}

// Compares the current 7-day mean with the distribution of historical 7-day means
// generated from the 90 calendar days immediately before the current window.
// This deliberately avoids treating a one-day spike as a validated anomaly.
export function sevenDayAnomalyVsPrior90(dailyValues) {
  if (!Array.isArray(dailyValues)) throw new Error('dailyValues must be an array');
  if (dailyValues.length < 97) {
    return { valid: false, reason: 'NEED_97_DAILY_OBSERVATIONS', observations: dailyValues.length };
  }

  const current7 = dailyValues.slice(-7);
  const prior90 = dailyValues.slice(-97, -7);
  const baseline7dMeans = rollingMeans(prior90, 7);
  const baselineMean = mean(baseline7dMeans);
  const baselineStd = sampleStd(baseline7dMeans);
  const currentMean = mean(current7);

  if (baselineStd === 0) {
    return {
      valid: false,
      reason: 'ZERO_BASELINE_VARIANCE',
      observations: dailyValues.length,
      current7dMean: currentMean,
      baseline7dMean: baselineMean
    };
  }

  return {
    valid: true,
    method: 'CURRENT_7D_MEAN_VS_PRIOR_90D_ROLLING_7D_MEANS',
    observations: dailyValues.length,
    current7dMean: currentMean,
    baseline7dMean: baselineMean,
    baselineStd,
    zScore: (currentMean - baselineMean) / baselineStd
  };
}

// Quantifies beneficiary exposure without imposing an invented pass threshold.
// A separate evidence-based decision must determine PASS/FAIL/UNRESOLVED.
export function beneficiaryMateriality({ relationshipAmountUsd, beneficiaryRevenueUsd, beneficiarySegmentRevenueUsd }) {
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return {
    ratioTotalRevenue: valid(relationshipAmountUsd) && valid(beneficiaryRevenueUsd)
      ? relationshipAmountUsd / beneficiaryRevenueUsd
      : null,
    ratioSegmentRevenue: valid(relationshipAmountUsd) && valid(beneficiarySegmentRevenueUsd)
      ? relationshipAmountUsd / beneficiarySegmentRevenueUsd
      : null
  };
}

export function alphaEligibility({ backfilled, methodologyActivatedTs, firstSightTs, snapshot }) {
  if (backfilled) return { eligible: false, reason: 'BACKFILLED' };
  if (!snapshot) return { eligible: false, reason: 'NO_T0_SNAPSHOT' };
  if (!['API', 'CONNECTOR'].includes(snapshot.sourceKind)) return { eligible: false, reason: 'NON_MACHINE_SNAPSHOT' };
  if (snapshot.status === 'FAILED') return { eligible: false, reason: 'SNAPSHOT_FAILED' };

  const activated = new Date(methodologyActivatedTs).getTime();
  const sight = new Date(firstSightTs).getTime();
  const captured = new Date(snapshot.capturedTs).getTime();
  if (![activated, sight, captured].every(Number.isFinite)) return { eligible: false, reason: 'INVALID_TIMESTAMP' };
  if (sight < activated) return { eligible: false, reason: 'PRE_ACTIVATION' };
  if (captured < sight || captured - sight > 5 * 60 * 1000) return { eligible: false, reason: 'SNAPSHOT_NOT_AT_SIGHT' };
  return { eligible: true, reason: 'ELIGIBLE' };
}
