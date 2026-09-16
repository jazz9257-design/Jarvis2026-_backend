"""Synthetic fixtures test implementation only; they are not investment evidence."""
import copy
import unittest
from engine import freeze, evaluate, score_stock, score_crypto, horizon_return
from prepare import select_population


def stock(i=0):
    fields = {'public_proxy': True, 'incremental': True, 'binding': True,
              'payment_kind': 'RECURRING_REVENUE', 'benefit_direction': 'INFLOW',
              'amount_12m': 100 + i, 'revenue_ttm': 1000, 'currency': 'USD'}
    return dict(id=str(i), event_id=str(i), lane='STOCK', asset_id=str(i), cluster_id=str(i),
                t0=f'2021-{i % 6 + 1:02d}-04T17:00:00Z', **fields,
                evidence={f: {'url': 'https://example.com/SYNTHETIC', 'sha256': 'a'*64,
                              'published_at': '2021-01-01T00:00:00Z'} for f in fields})


def inputs(n=120):
    cases = [stock(i) for i in range(n)]
    return dict(spec={'lane': 'STOCK', 'stage': 'TRAINING', 'variant': 1,
                      'prior_asset_registry_complete': True}, population=[c['id'] for c in cases],
                cases=cases, dispositions={c['id']: 'REVIEWED_WITH_CANDIDATES' for c in cases}, prior_assets=[])


class Tests(unittest.TestCase):
    def test_acceptance_boundary_not_index_date(self):
        rows = [{'form': '8-K', 'acceptance_et': '20210108180000', 'index_filing_date': '20210111'},
                {'form': '8-K', 'acceptance_et': '20201231170000', 'index_filing_date': '20210104'},
                {'form': '8-K/A', 'acceptance_et': '20210106120000'}]
        self.assertEqual(select_population(rows, '2021-01-04', '2021-01-08'), rows[:1])

    def test_disclosed_ratio(self):
        self.assertEqual(score_stock(stock())['score'], .1)

    def test_missing_is_not_zero(self):
        for bad in (None, False, '', '100', float('nan'), float('inf'), -1):
            c = stock(); c['amount_12m'] = bad
            self.assertIsNone(score_stock(c)['score'])

    def test_zero_is_measured(self):
        c = stock(); c['amount_12m'] = 0
        self.assertEqual(score_stock(c)['score'], 0)

    def test_future_source(self):
        c = stock(); c['evidence']['amount_12m']['published_at'] = '2022-01-01T00:00:00Z'
        self.assertIsNone(score_stock(c)['score'])

    def test_no_timezone(self):
        c = stock(); c['t0'] = '2021-01-04T17:00:00'
        with self.assertRaises(ValueError): score_stock(c)

    def test_reversed_economics(self):
        c = stock(); c['benefit_direction'] = 'REIMBURSEMENT_REMOVED'
        self.assertEqual(score_stock(c)['status'], 'NO_POSITIVE_COMMITMENT')

    def test_non_revenue(self):
        for kind in ('EQUITY', 'DEPOSIT', 'COST_TRANSFER'):
            c = stock(); c['payment_kind'] = kind
            self.assertEqual(score_stock(c)['status'], 'NOT_REVENUE')

    def test_cancellation(self):
        c = stock(); c['binding'] = False
        self.assertIsNone(score_stock(c)['score'])

    def test_missing_crypto_checks(self):
        self.assertEqual(score_crypto({'t0': '2021-01-01T00:00:00Z'})['status'], 'UNMEASURED')

    def test_crypto_veto(self):
        self.assertEqual(score_crypto({'vetoes': ['WASH_LIQUIDITY']})['status'], 'VETO')

    def test_population_omission(self):
        data = inputs(); del data['dispositions']['0']
        self.assertFalse(freeze(**data)['manifest']['outcome_access_allowed'])

    def test_prior_asset_exclusion(self):
        data = inputs(); data['prior_assets'] = ['119']
        sealed = freeze(**data)
        self.assertEqual(sealed['manifest']['rows'][-1]['status'], 'PREVIOUSLY_USED')

    def test_false_freshness(self):
        data = inputs(); data['spec']['prior_asset_registry_complete'] = False
        self.assertFalse(freeze(**data)['manifest']['outcome_access_allowed'])

    def test_duplicate_case(self):
        data = inputs(); data['cases'].append(data['cases'][0])
        with self.assertRaises(ValueError): freeze(**data)

    def test_mixed_lanes(self):
        data = inputs(); data['cases'][0]['lane'] = 'CRYPTO'
        with self.assertRaises(ValueError): freeze(**data)

    def test_outcomes_in_features(self):
        data = inputs(); data['cases'][0]['winner'] = True
        with self.assertRaises(ValueError): freeze(**data)

    def test_holdout_locked(self):
        data = inputs(); data['spec']['stage'] = 'HOLDOUT'
        with self.assertRaises(ValueError): freeze(**data)

    def test_variant_budget(self):
        data = inputs(); data['spec']['variant'] = 3
        with self.assertRaises(ValueError): freeze(**data)

    def test_tamper(self):
        sealed = freeze(**inputs()); sealed['manifest']['rows'][0]['selected'] = True
        with self.assertRaises(ValueError): evaluate(sealed, {})

    def test_incomplete_outcomes(self):
        sealed = freeze(**inputs())
        result = evaluate(sealed, {'freeze_sha256': sealed['sha256'], 'records': []})
        self.assertEqual(result['result'], 'BLOCKED')

    def test_calendar_horizon(self):
        prices = [{'open_at': '2021-01-04T14:30:00Z', 'close_at': '2021-01-04T21:00:00Z',
                   'adjusted_open': 100, 'adjusted_close': 101},
                  {'open_at': '2021-02-03T14:30:00Z', 'close_at': '2021-02-03T21:00:00Z',
                   'adjusted_open': 109, 'adjusted_close': 110}]
        self.assertAlmostEqual(horizon_return(prices, prices[0]['open_at'], 30, .001), .099)
        self.assertIsNone(horizon_return(prices, prices[0]['open_at'], 60, .001))

    def test_synthetic_success_stays_training_yellow(self):
        sealed = freeze(**inputs())
        records = []
        for row in sealed['manifest']['rows']:
            records.append({'case_id': row['case']['id'],
                            'net_benchmark_relative': {str(h): .1 if row['selected'] else -.1 for h in (30,60,90,180)},
                            'lead_days': {'media': 3, 'analyst': 4, 'market': 5},
                            'provenance': {k: 'SYNTHETIC_TEST_ONLY' for k in ('prices','benchmark','costs','factor_matching','delistings','session_coverage')}})
        result = evaluate(sealed, {'freeze_sha256': sealed['sha256'], 'records': records})
        self.assertEqual(result['result'], 'PASS')
        self.assertEqual(result['engine'], 'YELLOW')
        self.assertFalse(result['holdout_validated'])


if __name__ == '__main__': unittest.main()
