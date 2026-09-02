const CAPITAL_FLOW_TERMS = [
  'investment', 'invested', 'financing', 'funding', 'private placement',
  'convertible', 'acquisition', 'acquire', 'strategic agreement', 'joint venture',
  'capacity expansion', 'purchase commitment', 'offtake'
];

function isCapitalFlow(row) {
  const text = `${row.claim_text ?? ''} ${row.entity ?? ''}`.toLowerCase();
  return CAPITAL_FLOW_TERMS.some(term => text.includes(term));
}

export function evaluateVcJarvis(rows = []) {
  const candidates = rows
    .filter(row => row && row.venue_attention === 'LOW')
    .filter(isCapitalFlow)
    .map(row => ({
      sightingId: row.sighting_id,
      entity: row.entity,
      ticker: row.tradable_ticker ?? null,
      venue: row.venue,
      evidenceTier: row.evidence_tier,
      firstSightTs: row.first_sight_ts,
      claim: row.claim_text
    }));

  return {
    engine: 'VC_JARVIS',
    state: candidates.length ? 'GREEN' : 'YELLOW',
    reason: candidates.length
      ? 'Primary-source capital-flow candidates are present for VC/Hidden Beneficiary review.'
      : 'No new low-attention capital-flow candidate was found in the current source window.',
    candidates
  };
}
