import test from 'node:test';
import assert from 'node:assert/strict';
import { latestAnnualRevenueFromCompanyFacts } from '../src/adapters/secCompanyFacts.js';

test('selects latest 10-K annual revenue fact from SEC companyfacts fixture', () => {
  const payload = {
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              { form: '10-Q', start: '2026-01-01', end: '2026-03-31', filed: '2026-05-01', val: 25 },
              { form: '10-K', start: '2024-01-01', end: '2024-12-31', filed: '2025-02-10', val: 80 },
              { form: '10-K', start: '2025-01-01', end: '2025-12-31', filed: '2026-02-10', val: 90 }
            ]
          }
        }
      }
    }
  };
  const row = latestAnnualRevenueFromCompanyFacts(payload);
  assert.equal(row.val, 90);
  assert.equal(row.end, '2025-12-31');
  assert.equal(row.concept, 'RevenueFromContractWithCustomerExcludingAssessedTax');
});
