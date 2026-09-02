function latestResolution(context) {
  return context.beneficiaryResolution ?? null;
}

export function evaluateJarvis(context) {
  const { sighting } = context;
  if (!sighting) throw new Error('JARVIS requires a sighting');

  if (sighting.lane === 'STOCK') {
    const resolution = latestResolution(context);
    if (!resolution) {
      return {
        state: 'YELLOW',
        reason: 'Primary-source sighting exists, but no tradable beneficiary has passed materiality resolution yet.',
        failedGates: ['TRADABLE_BENEFICIARY_UNRESOLVED']
      };
    }

    if (resolution.materiality_status === 'FAIL') {
      return {
        state: 'RED',
        reason: 'The economic relationship is real but failed materiality-to-beneficiary review.',
        failedGates: ['BENEFICIARY_MATERIALITY_FAILED']
      };
    }

    if (resolution.materiality_status !== 'PASS') {
      return {
        state: 'YELLOW',
        reason: 'Tradable beneficiary is identified, but materiality to that beneficiary is unresolved.',
        failedGates: ['BENEFICIARY_MATERIALITY_UNRESOLVED']
      };
    }

    if (!['REPORTED', 'VERIFIED'].includes(sighting.evidence_tier)) {
      return {
        state: 'YELLOW',
        reason: 'Beneficiary materiality passed, but the underlying evidence remains precursor-level.',
        failedGates: ['PRIMARY_EVIDENCE_NOT_YET_REPORTED_OR_VERIFIED']
      };
    }

    return {
      state: 'GREEN',
      reason: 'Company-specific evidence is reported/verified and material to the tradable beneficiary.',
      failedGates: []
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
