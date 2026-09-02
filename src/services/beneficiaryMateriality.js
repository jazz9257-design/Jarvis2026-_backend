import { fetchLatestAnnualRevenue } from '../adapters/secCompanyFacts.js';
import { fetchTiingoStockSnapshot } from '../market/tiingo.js';
import { recordBeneficiaryResolutionWithSnapshot } from '../ledger.js';

// Quantifies materiality to the public beneficiary using primary-source SEC revenue.
// It deliberately does not invent a percentage cutoff. JARVIS/Sentinel must explicitly
// assign PASS/FAIL/UNRESOLVED based on the evidence and existing rules.
export async function evaluatePublicBeneficiary(pool, {
  sightingId,
  catalystEntity,
  beneficiaryTicker,
  relationshipAmountUsd,
  materialityStatus = 'UNRESOLVED',
  qualitativeMateriality = null,
  evidence = {},
  notes = null
}) {
  const revenue = await fetchLatestAnnualRevenue(beneficiaryTicker);

  const recorded = await recordBeneficiaryResolutionWithSnapshot(pool, {
    sightingId,
    catalystEntity,
    beneficiaryTicker,
    relationshipAmountUsd,
    beneficiaryRevenueUsd: revenue.revenueUsd,
    beneficiarySegmentRevenueUsd: null,
    qualitativeMateriality,
    materialityStatus,
    evidence: {
      ...evidence,
      beneficiaryRevenue: revenue
    },
    notes
  }, fetchTiingoStockSnapshot);

  return {
    ...recorded,
    revenue,
    continueResolution: recorded.resolution.materiality_status !== 'PASS'
  };
}
