function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function evaluateRecognition(snapshot) {
  if (!snapshot || snapshot.status === 'FAILED') {
    return { state: 'UNMEASURED', reason: 'No usable contemporaneous market snapshot.', basis: {} };
  }

  const ret5d = num(snapshot.ret_5d ?? snapshot.ret5d);
  const ret20d = num(snapshot.ret_20d ?? snapshot.ret20d);
  const vol = num(snapshot.volume_ratio_5d_90d ?? snapshot.volumeRatio5d90d);
  const basis = { ret5d, ret20d, volumeRatio5d90d: vol, price: num(snapshot.price), source: snapshot.source_name ?? snapshot.sourceName };

  if (ret5d == null && ret20d == null && vol == null) {
    return { state: 'UNMEASURED', reason: 'Snapshot lacks recognition metrics.', basis };
  }

  // Recognition is intentionally conservative and based only on market behavior.
  if ((ret5d != null && ret5d >= 0.20) || (ret20d != null && ret20d >= 0.35) || (vol != null && vol >= 2.5)) {
    return { state: 'RED', reason: 'Price/volume behavior indicates substantial market recognition already occurred.', basis };
  }

  if ((ret5d != null && ret5d >= 0.08) || (ret20d != null && ret20d >= 0.15) || (vol != null && vol >= 1.5)) {
    return { state: 'YELLOW', reason: 'Some market recognition is visible; recognition gap is uncertain.', basis };
  }

  return { state: 'GREEN', reason: 'No large price/volume recognition signal is visible at first sight.', basis };
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

export function evaluateArgus({ snapshot, setup = null, rewardRisk = null }) {
  const recognition = evaluateRecognition(snapshot);
  const execution = evaluateExecution({ recognition, setup, rewardRisk });
  return { recognition, execution };
}
