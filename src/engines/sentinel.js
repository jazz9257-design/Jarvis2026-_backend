export function evaluateSentinel(context) {
  const { sighting, riskEvidence = {} } = context;
  if (!sighting) throw new Error('Sentinel requires a sighting');

  const vetoes = Array.isArray(riskEvidence.vetoes) ? riskEvidence.vetoes.filter(Boolean) : [];
  if (vetoes.length) {
    return {
      state: 'RED',
      reason: 'One or more explicit Sentinel vetoes fired.',
      vetoes,
      missing: []
    };
  }

  if (sighting.lane === 'CRYPTO') {
    const required = [
      ['contractVerified', 'CONTRACT_SAFETY_UNVERIFIED'],
      ['liquidityQualityVerified', 'LIQUIDITY_QUALITY_UNVERIFIED'],
      ['holderConcentrationReviewed', 'HOLDER_CONCENTRATION_UNREVIEWED'],
      ['unlockRiskReviewed', 'UNLOCK_RISK_UNREVIEWED']
    ];
    const missing = required.filter(([key]) => riskEvidence[key] !== true).map(([, label]) => label);
    if (missing.length) {
      return {
        state: 'YELLOW',
        reason: 'No explicit veto fired, but required crypto safety evidence is incomplete.',
        vetoes: [],
        missing
      };
    }
    return {
      state: 'GREEN',
      reason: 'Required crypto safety checks are present and no coded veto fired.',
      vetoes: [],
      missing: []
    };
  }

  if (sighting.lane === 'STOCK') {
    const missing = [];
    if (riskEvidence.primarySourceVerified !== true) missing.push('PRIMARY_SOURCE_NOT_VERIFIED');
    if (riskEvidence.beneficiaryRiskReviewed !== true) missing.push('BENEFICIARY_RISK_NOT_REVIEWED');
    if (missing.length) {
      return {
        state: 'YELLOW',
        reason: 'No explicit veto fired, but stock risk review is incomplete.',
        vetoes: [],
        missing
      };
    }
    return {
      state: 'GREEN',
      reason: 'Required stock risk checks are present and no coded veto fired.',
      vetoes: [],
      missing: []
    };
  }

  return {
    state: 'RED',
    reason: `Unsupported Sentinel lane: ${sighting.lane}`,
    vetoes: ['UNSUPPORTED_LANE'],
    missing: []
  };
}
