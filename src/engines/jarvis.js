function latestResolution(context) {
  return context.beneficiaryResolution ?? null;
}

function precursorPriority(context) {
  const { sighting, precursorContext = {} } = context;
  if (!sighting || sighting.lane !== 'STOCK') return null;

  const relatedOrders = Number(precursorContext.priorRelatedOrderCount ?? 0);
  const commitments = Number(precursorContext.priorCapitalCommitmentCount ?? 0);

  if (relatedOrders >= 2 && commitments >= 1) {
    return {
      state: 'IMMEDIATE_REVIEW',
      reason: 'Repeated related orders plus an earlier capital/capacity commitment require immediate JARVIS × ARGUS review.'
    };
  }
  if (relatedOrders >= 1) {
    return {
      state: 'ELEVATE',
      reason: 'A second related order/award is present; elevate the beneficiary for materiality and recognition review.'
    };
  }
  if (['PRECURSOR', 'REPORTED', 'VERIFIED'].includes(sighting.evidence_tier)) {
    return {
      state: 'INVESTIGATE',
      reason: 'An economically relevant precursor is present; investigate the beneficiary before the later headline.'
    };
  }
  return { state: 'NORMAL', reason: 'No precursor escalation condition is present.' };
}

export function evaluateJarvis(context) {
  const { sighting } = context;
  if (!sighting) throw new Error('JARVIS requires a sighting');

  if (sighting.lane === 'STOCK') {
    const resolution = latestResolution(context);
    const precursor = precursorPriority(context);

    if (!resolution) {
      return {
        state: 'YELLOW',
        reason: 'Primary-source sighting exists, but no tradable beneficiary has passed materiality resolution yet.',
        failedGates: ['TRADABLE_BENEFICIARY_UNRESOLVED'],
        precursor
      };
    }

    if (resolution.materiality_status === 'FAIL') {
      return {
        state: 'RED',
        reason: 'The economic relationship is real but failed materiality-to-beneficiary review. Earlier discovery does not override failed materiality.',
        failedGates: ['BENEFICIARY_MATERIALITY_FAILED'],
        precursor
      };
    }

    if (resolution.materiality_status !== 'PASS') {
      return {
        state: 'YELLOW',
        reason: 'Tradable beneficiary is identified, but materiality to that beneficiary is unresolved.',
        failedGates: ['BENEFICIARY_MATERIALITY_UNRESOLVED'],
        precursor
      };
    }

    if (!['REPORTED', 'VERIFIED'].includes(sighting.evidence_tier)) {
      return {
        state: 'YELLOW',
        reason: 'Beneficiary materiality passed, but the underlying evidence remains precursor-level. Keep it early-watchlist only until reported/verified.',
        failedGates: ['PRIMARY_EVIDENCE_NOT_YET_REPORTED_OR_VERIFIED'],
        precursor
      };
    }

    return {
      state: 'GREEN',
      reason: 'Company-specific evidence is reported/verified and material to the tradable beneficiary.',
      failedGates: [],
      precursor
    };
  }

  if (sighting.lane === 'CRYPTO') {
    const substance = context.cryptoSubstance ?? {};
    if (substance.invalidated === true) {
      return {
        state: 'RED',
        reason: substance.reason ?? 'The measured anomaly failed economic-substance validation.',
        failedGates: ['CRYPTO_ANOMALY_INVALIDATED']
      };
    }

    if (substance.valueCaptureVerified === true && substance.anomalySubstanceVerified === true) {
      return {
        state: 'GREEN',
        reason: 'The self-relative anomaly is measured, economically substantive, and has verified token value capture.',
        failedGates: []
      };
    }

    return {
      state: 'YELLOW',
      reason: 'The anomaly is measured, but substance and token value capture are not both code-verified yet.',
      failedGates: ['CRYPTO_SUBSTANCE_OR_VALUE_CAPTURE_PENDING']
    };
  }

  return {
    state: 'RED',
    reason: `Unsupported JARVIS lane: ${sighting.lane}`,
    failedGates: ['UNSUPPORTED_LANE']
  };
}
