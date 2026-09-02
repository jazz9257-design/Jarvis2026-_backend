# JARVIS 2026 Backend

Production backend for JARVIS Economic Intelligence OS.

## Current implementation target

LT-1.0 moves lead-time tracking from policy-only Google Sheets into a code-enforced Postgres ledger.

### Invariants

- Raw sightings are append-only.
- `first_sight_ts` is database-generated.
- Backfilled observations never earn forward alpha credit.
- Market snapshots are stored separately from raw sightings.
- Assessments append; they never overwrite t0 observations.
- Stock beneficiary resolution requires materiality to the tradable beneficiary, not merely a real relationship.
- Crypto earliness is measured as self-relative anomaly onset, not token age.
- Existing JARVIS → ARGUS → Sentinel separation and trade states remain unchanged.

## Quick start

```bash
npm install
cp .env.example .env
npm run migrate
npm run db:check
npm test
```

`DATABASE_URL` must point to the Railway Postgres instance before migrations or DB checks will run.

## Current status

Repository initialized 2026-09-01. Until the migration is actually run against production Postgres and verified, LT-1.0 remains **POLICY-ENFORCED, NOT CODE-ENFORCED**.
