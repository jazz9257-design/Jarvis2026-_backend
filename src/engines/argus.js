function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function raw(snapshot) {
  if (!snapshot) return {};
  if (snapshot.raw_payload && typeof snapshot.raw_payload === 'object') return snapshot.raw_payload;
  if (snapshot.rawPayload && typeof snapshot.rawPayload === 'object') return snapshot.rawPayload;
  return {};
}

export function evaluateRecognition(snapshot, {
  yellowZ = Number(process.env.ARGUS_RECOGNITION_YELLOW_Z ?? 1),
  redZ = Number(process.env.ARGUS_RECOGNITION_RED_Z ?? 2)
} = {}) {
  if (!snapshot || snapshot.status === 'FAILED') {
    return { state: 'UNMEASURED', reason: 'No usable contemporaneous market snapshot.', basis: {} };
  }

  const metrics = raw(snapshot).recognitionMetrics ?? {};
  const returnZ = num(metrics.current5dReturnZ);
  const volumeZ = num(metrics.current5dVolumeZ);
  const basis = {
    price: num(snapshot.price),
    ret5d: num(snapshot.ret_5d ?? snapshot.ret5d),
    ret20d: num(snapshot.ret_20d ?? snapshot.ret20d),
    volumeRatio5d90d: num(snapshot.volume_ratio_5d_90d ?? snapshot.volumeRatio5d90d),
    current5dReturnZ: returnZ,
    current5dVolumeZ: volumeZ,
    source: snapshot.source_name ?? snapshot.sourceName,
    yellowZ,
    redZ
  };

  if (returnZ == null && volumeZ == null) {
    return {
      state: 'UNMEASURED',
      reason: 'Snapshot exists, but self-relative recognition statistics are unavailable.',
      basis
    };
  }

  const maxPositiveZ = Math.max(returnZ ?? -Infinity, volumeZ ?? -Infinity);
  if (maxPositiveZ >= redZ) {
    return { state: 'RED', reason: 'Price/volume behavior is a >= red-threshold self-relative outlier; broad recognition likely occurred.', basis };
  }
  if (maxPositiveZ >= yellowZ) {
    return { state: 'YELLOW', reason: 'Price/volume behavior is elevated versus its own history; recognition gap is uncertain.', basis };
  }
  return { state: 'GREEN', reason: 'Price/volume behavior is not elevated versus its own history at first sight.', basis };
}

export function evaluateExecution({ recognition, setup = null, rewardRisk = null }) {
  if (!recognition || recognition.state === 'UNMEASURED') {
    return { state: 'UNMEASURED', reason: 'Recognition must be measured before execution.', basis: {} };
  }
  if (recognition.state === 'RED') {
    return { state: 'RED', reason: 'Execution blocked because the opportunity appears already recognized.', basis: {} };
  }
  if (!setup || setup.valid !== true) {
    return { state: 'YELLOW', reason: 'Recognition gap may exist, but no coded technical/setup confirmation exists yet.', basis: setup ?? {} };
  }
  if (!Number.isFinite(Number(rewardRisk)) || Number(rewardRisk) < 3) {
    return { state: 'RED', reason: 'Setup fails the existing >=3:1 reward/risk requirement.', basis: { rewardRisk } };
  }
  return { state: 'GREEN', reason: 'Recognition gap, valid setup, and >=3:1 reward/risk are all present.', basis: { ...setup, rewardRisk: Number(rewardRisk) } };
}

export function evaluateArgus({ snapshot, setup = null, rewardRisk = null, thresholds = undefined }) {
  const recognition = evaluateRecognition(snapshot, thresholds);
  const execution = evaluateExecution({ recognition, setup, rewardRisk });
  return { recognition, execution };
}
