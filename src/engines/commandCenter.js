function laneSummary(evaluations, lane) {
  const rows = evaluations.filter(x => x.lane === lane);
  const tradeCandidates = rows.filter(x => x.decision === 'TRADE CANDIDATE');
  const rejected = rows.filter(x => x.decision === 'REJECT');
  return {
    engineHealth: 'GREEN',
    opportunity: tradeCandidates.length ? 'GREEN' : 'YELLOW',
    evaluated: rows.length,
    tradeCandidates: tradeCandidates.length,
    rejected: rejected.length
  };
}

export function buildCommandCenter({ evaluations = [], vc = null, scanErrors = [] } = {}) {
  const stock = laneSummary(evaluations, 'STOCK');
  const crypto = laneSummary(evaluations, 'CRYPTO');
  const anyTrade = evaluations.some(x => x.decision === 'TRADE CANDIDATE');

  return {
    engineHealth: scanErrors.length ? 'YELLOW' : 'GREEN',
    opportunity: anyTrade ? 'GREEN' : 'YELLOW',
    stock,
    crypto,
    vc: {
      engineHealth: vc ? 'GREEN' : 'YELLOW',
      opportunity: vc?.candidates?.length ? 'GREEN' : 'YELLOW',
      candidates: vc?.candidates?.length ?? 0
    },
    alerts: evaluations
      .filter(x => ['TRADE CANDIDATE', 'REJECT'].includes(x.decision))
      .map(x => ({ lane: x.lane, ticker: x.ticker, decision: x.decision, stage: x.stage }))
  };
}
