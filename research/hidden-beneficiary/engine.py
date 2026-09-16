"""Independent research component. Standard library only; never submits trades.

Evidence assertions require human/source review; a URL/hash validates provenance,
not the truth of an assertion. No outcome data belongs in freeze inputs.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import random
import statistics

VERSION = 'upstream-commitment-1.0'
HORIZONS = (30, 60, 90, 180)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def timestamp(value):
    x = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if x.tzinfo is None:
        raise ValueError('Explicit timezone required')
    return x


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def evidence_errors(case, fields):
    errors = []
    cutoff = timestamp(case['t0'])
    for field in fields:
        proof = case.get('evidence', {}).get(field, {})
        if not proof.get('url', '').startswith('https://') or len(proof.get('sha256', '')) != 64:
            errors.append(field + ':SOURCE_MISSING')
        try:
            if timestamp(proof['published_at']) > cutoff:
                errors.append(field + ':AFTER_T0')
        except (KeyError, ValueError, TypeError, AttributeError):
            errors.append(field + ':TIME_UNVERIFIED')
    return errors


def score_stock(case):
    """Score only disclosed, incremental, binding revenue within 12 months.

    Inputs are in one stated currency; no inferred customer-spend allocation.
    Negative economics are not negative return labels. Unknown != zero.
    """
    if case.get('benefit_direction') in ('OUTFLOW', 'REIMBURSEMENT_REMOVED') and not evidence_errors(case, ['benefit_direction']):
        return {'status': 'NO_POSITIVE_COMMITMENT', 'score': None, 'reasons': ['ECONOMIC_DIRECTION']}
    if case.get('payment_kind') in ('EQUITY', 'DEPOSIT', 'COST_TRANSFER') and not evidence_errors(case, ['payment_kind']):
        return {'status': 'NOT_REVENUE', 'score': None, 'reasons': ['DEPOSIT_EQUITY_OR_COST_TRANSFER']}
    required = ['public_proxy', 'incremental', 'binding', 'payment_kind',
                'benefit_direction', 'amount_12m', 'revenue_ttm', 'currency']
    errors = evidence_errors(case, required)
    if errors:
        return {'status': 'UNMEASURED', 'score': None, 'reasons': errors}
    if case.get('public_proxy') is not True:
        return {'status': 'NO_PUBLIC_PROXY', 'score': None, 'reasons': ['NO_VERIFIED_PUBLIC_PROXY']}
    if case.get('benefit_direction') != 'INFLOW':
        return {'status': 'NO_POSITIVE_COMMITMENT', 'score': None, 'reasons': ['ECONOMIC_DIRECTION']}
    if case.get('payment_kind') not in ('RECURRING_REVENUE', 'ONE_TIME_REVENUE'):
        return {'status': 'NOT_REVENUE', 'score': None, 'reasons': ['DEPOSIT_EQUITY_OR_COST_TRANSFER']}
    if case.get('binding') is not True or case.get('incremental') is not True:
        return {'status': 'UNMEASURED', 'score': None, 'reasons': ['BINDING_INCREMENT_NOT_ESTABLISHED']}
    amount, revenue = case.get('amount_12m'), case.get('revenue_ttm')
    if not number(amount) or amount < 0 or not number(revenue) or revenue <= 0 or not case.get('currency'):
        return {'status': 'UNMEASURED', 'score': None, 'reasons': ['AMOUNT_DENOMINATOR_OR_CURRENCY']}
    return {'status': 'MEASURABLE', 'score': amount / revenue, 'reasons': []}


def score_crypto(case):
    """Eligibility and separate evidence-qualified anomaly score, not live Sentinel replacement."""
    vetoes = case.get('vetoes', [])
    if vetoes:
        return {'status': 'VETO', 'score': None, 'reasons': vetoes}
    checks = ['historical_token_identity', 'capture_active', 'contract_safe',
              'claims_verified', 'concentration_safe', 'liquidity_genuine', 'dilution_safe']
    fields = checks + ['holder_revenue_7d', 'prior_90d_p95', 'incentives_7d', 'dilution_7d']
    errors = evidence_errors(case, fields)
    errors += [x + ':UNVERIFIED' for x in checks if case.get(x) is not True]
    for x in fields[len(checks):]:
        if not number(case.get(x)) or case[x] < 0:
            errors.append(x + ':UNMEASURED')
    if errors:
        return {'status': 'UNMEASURED', 'score': None, 'reasons': errors}
    # The p95 must use completed prior windows; loader must certify this source field.
    net = case['holder_revenue_7d'] - case['incentives_7d'] - case['dilution_7d']
    crossed = case['holder_revenue_7d'] > case['prior_90d_p95'] and net > 0
    return {'status': 'MEASURABLE', 'score': int(crossed), 'reasons': [], 'net_holder_economics': net}


def freeze(spec, population, cases, dispositions, prior_assets):
    """Return a sealed pre-outcome manifest, including blocked cases and population omissions."""
    errors = []
    lane = spec['lane']
    if lane not in ('STOCK', 'CRYPTO'):
        raise ValueError('Separate STOCK and CRYPTO runs required')
    if spec.get('stage') != 'TRAINING':
        raise ValueError('Holdout is locked; this runner supports development only')
    if spec.get('variant', 1) not in (1, 2):
        raise ValueError('Development variant budget exceeded')
    if len(population) != len(set(population)):
        errors.append('DUPLICATE_POPULATION_IDS')
    if set(dispositions) != set(population):
        errors.append('POPULATION_DISPOSITIONS_INCOMPLETE')
    if any(x not in ('REVIEWED_WITH_CANDIDATES', 'REVIEWED_NO_PROXY', 'REVIEWED_NO_COMMITMENT')
           for x in dispositions.values()):
        errors.append('UNREVIEWED_POPULATION')
    if spec.get('prior_asset_registry_complete') is not True:
        errors.append('FRESHNESS_REGISTRY_INCOMPLETE')
    scored = []
    ids = set()
    for case in cases:
        if case['id'] in ids:
            raise ValueError('Duplicate case ID')
        ids.add(case['id'])
        if case['lane'] != lane:
            raise ValueError('Mixed asset classes')
        if any(k in case for k in ('returns', 'winner', 'outcomes', 'future_price')):
            raise ValueError('Outcome field in pre-outcome input')
        if case['event_id'] not in population:
            raise ValueError('Candidate outside frozen population')
        result = score_stock(case) if lane == 'STOCK' else score_crypto(case)
        economic_assessment = dict(result)
        if not case.get('asset_id'):
            result = {'status': 'UNMEASURED', 'score': None, 'reasons': ['ASSET_ID_UNVERIFIED']}
        elif case['asset_id'] in prior_assets:
            result = {'status': 'PREVIOUSLY_USED', 'score': None, 'reasons': ['FRESH_COMPANY_EXCLUSION']}
        scored.append({'case': case, **result, 'economic_assessment': economic_assessment, 'selected': False})
    for event in population:
        present = any(c['event_id'] == event for c in cases)
        if present != (dispositions.get(event) == 'REVIEWED_WITH_CANDIDATES'):
            errors.append('CANDIDATE_DISPOSITION_MISMATCH:' + event)
    measurable = sorted((r for r in scored if r['status'] == 'MEASURABLE'),
                        key=lambda r: (-r['score'], r['case']['id']))
    if lane == 'STOCK':
        for r in measurable[:math.ceil(len(measurable) / 4)]:
            r['selected'] = True
    else:
        for r in measurable:
            r['selected'] = r['score'] == 1
    clusters = {r['case']['cluster_id'] for r in measurable if r['selected']}
    if len(clusters) < 30:
        errors.append('FEWER_THAN_30_SELECTED_CLUSTERS')
    if not any(not r['selected'] for r in measurable):
        errors.append('NO_MEASURABLE_CONTROLS')
    body = {'version': VERSION, 'spec': spec, 'population': population, 'dispositions': dispositions,
            'prior_assets': sorted(prior_assets), 'rows': scored, 'errors': sorted(set(errors)),
            'outcome_access_allowed': not errors, 'code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return {'sha256': digest(body), 'manifest': body}


def horizon_return(prices, entry_at, days, costs):
    """Use observed executable entry open and first observed close on/after target.

    prices rows: timestamped adjusted open/close. The caller certifies corporate
    actions, delistings and complete trading-session coverage before evaluation.
    """
    if not number(costs) or costs < 0:
        raise ValueError('Documented nonnegative round-trip cost required')
    start = timestamp(entry_at)
    entry = next((p for p in prices if timestamp(p['open_at']) == start), None)
    target = start + dt.timedelta(days=days)
    exits = [p for p in prices if timestamp(p['close_at']) >= target]
    if entry is None or not exits:
        return None
    end = min(exits, key=lambda p: timestamp(p['close_at']))
    if not number(entry['adjusted_open']) or entry['adjusted_open'] <= 0:
        return None
    if not number(end['adjusted_close']) or end['adjusted_close'] < 0:
        return None
    return end['adjusted_close'] / entry['adjusted_open'] - 1 - costs


def evaluate(sealed, outcomes):
    body = sealed['manifest']
    if digest(body) != sealed['sha256']:
        raise ValueError('Frozen manifest modified')
    if not body['outcome_access_allowed']:
        return {'engine': 'YELLOW', 'stage': 'TRAINING', 'result': 'BLOCKED',
                'errors': body['errors'], 'investment_outcomes_evaluated': 0}
    if outcomes.get('freeze_sha256') != sealed['sha256']:
        raise ValueError('Outcomes do not reference frozen scores')
    records = outcomes.get('records', [])
    if len({r['case_id'] for r in records}) != len(records):
        raise ValueError('Duplicate outcome records')
    by_id = {r['case_id']: r for r in records}
    measured = [r for r in body['rows'] if r['status'] == 'MEASURABLE']
    observable = [r for r in body['rows'] if r['case'].get('asset_id') and r['status'] != 'PREVIOUSLY_USED']
    expected = {r['case']['id'] for r in observable}
    if set(by_id) != expected:
        return {'result': 'BLOCKED', 'errors': ['OUTCOME_MEMBERSHIP_MISMATCH'],
                'missing': sorted(expected - set(by_id)), 'unexpected': sorted(set(by_id) - expected)}
    required = ('prices', 'benchmark', 'costs', 'factor_matching', 'delistings', 'session_coverage')
    if any(not all(o.get('provenance', {}).get(k) for k in required) for o in records):
        return {'result': 'BLOCKED', 'errors': ['OUTCOME_PROVENANCE_INCOMPLETE']}
    if any(not all(number(o.get('net_benchmark_relative', {}).get(str(h))) for h in HORIZONS) for o in records):
        return {'result': 'BLOCKED', 'errors': ['INCOMPLETE_HORIZONS']}
    samples = []
    for r in measured:
        o = by_id[r['case']['id']]
        excess = o.get('net_benchmark_relative', {})
        if not all(number(excess.get(str(h))) for h in HORIZONS):
            return {'result': 'BLOCKED', 'errors': ['INCOMPLETE_HORIZONS']}
        samples.append({'selected': r['selected'], 'cluster': r['case']['cluster_id'],
                        'month': r['case']['t0'][:7], 'excess': excess, 'outcome': o})
    def difference(items, horizon='90', weights=None):
        arms = []
        for selected in (True, False):
            arm = [(x, 1 if weights is None else weights(x)) for x in items if x['selected'] == selected]
            total = sum(w for _, w in arm)
            if not total:
                return None
            arms.append(sum(x['excess'][horizon] * w for x, w in arm) / total)
        return arms[0] - arms[1]
    clusters, months = sorted({x['cluster'] for x in samples}), sorted({x['month'] for x in samples})
    if len(months) < 2:
        return {'result': 'BLOCKED', 'errors': ['INSUFFICIENT_MONTH_CLUSTERS_FOR_REGISTERED_BOOTSTRAP']}
    rng = random.Random(42)
    boot = []
    for _ in range(10000):
        cdraw = rng.choices(clusters, k=len(clusters)); mdraw = rng.choices(months, k=len(months))
        cw = {c: cdraw.count(c) for c in clusters}; mw = {m: mdraw.count(m) for m in months}
        value = difference(samples, weights=lambda x: cw[x['cluster']] * mw[x['month']])
        if value is not None:
            boot.append(value)
    if len(boot) < 9500:
        return {'result': 'BLOCKED', 'errors': ['UNSTABLE_BOOTSTRAP_ARMS']}
    boot.sort()
    # Two predeclared variants: Bonferroni interval; never choose a favorable horizon.
    ci = [boot[int(len(boot) * .0125)], boot[min(len(boot)-1, int(len(boot) * .9875))]]
    recognition = {}
    for proxy in ('media', 'analyst', 'market'):
        leads = [x['outcome'].get('lead_days', {}).get(proxy) for x in samples if x['selected']]
        observed = [x for x in leads if number(x)]
        recognition[proxy] = {'observed': len(observed), 'total': len(leads),
                              'median_days': statistics.median(observed) if observed else None}
    lead_pass = all(x['observed'] == x['total'] and x['observed'] > 0 and x['median_days'] > 0
                    for x in recognition.values())
    passed = ci[0] > 0 and lead_pass
    return {'engine': 'YELLOW', 'stage': 'TRAINING', 'result': 'PASS' if passed else 'FAIL',
            'holdout_validated': False, 'investment_outcomes_evaluated': len(samples),
            'spread': {str(h): difference(samples, str(h)) for h in HORIZONS},
            'primary_90d_simultaneous_ci': ci, 'bootstrap_valid_resamples': len(boot),
            'false_positives': sum(x['selected'] and x['excess']['90'] <= 0 for x in samples),
            'false_negatives': sum(not x['selected'] and x['excess']['90'] > 0 for x in samples),
            'unscored_or_vetoed_winners': sum(r['status'] != 'MEASURABLE' and by_id[r['case']['id']]['net_benchmark_relative']['90'] > 0 for r in observable),
            'unknown_asset_outcomes': sum(not r['case'].get('asset_id') for r in body['rows']),
            'recognition': recognition, 'realized_pnl': None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['freeze', 'evaluate'])
    parser.add_argument('input'); parser.add_argument('output')
    args = parser.parse_args()
    data = json.loads(Path(args.input).read_text())
    result = freeze(**data) if args.command == 'freeze' else evaluate(**data)
    # Refuse to overwrite an existing seal/result; each attempt remains visible.
    with Path(args.output).open('x') as f:
        json.dump(result, f, indent=2, allow_nan=False)
    print(json.dumps({'output': args.output, 'result': result.get('result'),
                      'errors': result.get('errors', result.get('manifest', {}).get('errors', []))}))


if __name__ == '__main__':
    main()
