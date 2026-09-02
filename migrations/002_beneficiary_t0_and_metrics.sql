-- Stock recognition must be measured when a tradable beneficiary is first resolved,
-- not on a private catalyst entity and not hours/days later without disclosure.

ALTER TABLE beneficiary_resolutions
  ADD COLUMN IF NOT EXISTS first_beneficiary_sight_ts timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS beneficiary_market_snapshots (
  beneficiary_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_id uuid NOT NULL REFERENCES beneficiary_resolutions(resolution_id),
  captured_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  ticker text NOT NULL,
  price numeric,
  ret_5d numeric,
  ret_20d numeric,
  volume_ratio_5d_90d numeric,
  news_count_7d integer,
  analyst_count integer,
  benchmark text,
  source_name text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('API','CONNECTOR','WEB_READ','MANUAL')),
  status text NOT NULL CHECK (status IN ('FULL','PARTIAL','FAILED')),
  raw_payload jsonb,
  missing_reason text
);

CREATE INDEX IF NOT EXISTS beneficiary_market_snapshots_resolution_time_idx
  ON beneficiary_market_snapshots(resolution_id, captured_ts);

DROP TRIGGER IF EXISTS beneficiary_market_snapshots_no_update ON beneficiary_market_snapshots;
CREATE TRIGGER beneficiary_market_snapshots_no_update
  BEFORE UPDATE ON beneficiary_market_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS beneficiary_market_snapshots_no_delete ON beneficiary_market_snapshots;
CREATE TRIGGER beneficiary_market_snapshots_no_delete
  BEFORE DELETE ON beneficiary_market_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS beneficiary_resolution_id uuid REFERENCES beneficiary_resolutions(resolution_id);

CREATE OR REPLACE VIEW beneficiary_resolutions_with_t0_snapshot AS
SELECT
  br.*,
  bms.beneficiary_snapshot_id,
  bms.captured_ts,
  bms.price,
  bms.ret_5d,
  bms.ret_20d,
  bms.volume_ratio_5d_90d,
  bms.source_name AS market_source_name,
  bms.source_kind AS market_source_kind,
  bms.status AS snapshot_status,
  CASE
    WHEN s.backfilled THEN false
    WHEN br.first_beneficiary_sight_ts < mv.activated_ts THEN false
    WHEN bms.beneficiary_snapshot_id IS NULL THEN false
    WHEN bms.source_kind NOT IN ('API','CONNECTOR') THEN false
    WHEN bms.status = 'FAILED' THEN false
    WHEN bms.captured_ts < br.first_beneficiary_sight_ts THEN false
    WHEN bms.captured_ts > br.first_beneficiary_sight_ts + interval '5 minutes' THEN false
    ELSE true
  END AS snapshot_alpha_eligible
FROM beneficiary_resolutions br
JOIN sightings s ON s.sighting_id = br.sighting_id
JOIN methodology_versions mv ON mv.version = s.methodology_version
LEFT JOIN LATERAL (
  SELECT x.*
  FROM beneficiary_market_snapshots x
  WHERE x.resolution_id = br.resolution_id
  ORDER BY x.captured_ts ASC
  LIMIT 1
) bms ON true;

-- Raw elapsed hours are always computable. Stock trading-session lead time is intentionally
-- not approximated with calendar days. It stays NULL until an exchange-session calendar is loaded.
CREATE TABLE IF NOT EXISTS market_sessions (
  exchange text NOT NULL,
  session_date date NOT NULL,
  source_name text NOT NULL,
  loaded_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(exchange, session_date)
);

-- PostgreSQL cannot use CREATE OR REPLACE VIEW when the existing view's column identity/order changes.
-- Drop and recreate because this migration is itself versioned and transactionally applied.
DROP VIEW IF EXISTS lead_time_report;
CREATE VIEW lead_time_report AS
WITH first_recognition AS (
  SELECT DISTINCT ON (sighting_id)
    sighting_id,
    event_ts
  FROM recognition_events
  WHERE event_type = 'HIGH_ATTENTION_FIRST_SEEN'
  ORDER BY sighting_id, event_ts ASC
)
SELECT
  s.sighting_id,
  s.lane,
  s.venue,
  s.evidence_tier,
  s.first_sight_ts,
  fr.event_ts AS first_high_attention_ts,
  CASE WHEN fr.event_ts IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (fr.event_ts - s.first_sight_ts)) / 3600.0 END AS lead_time_hours,
  CASE WHEN s.lane <> 'STOCK' OR fr.event_ts IS NULL THEN NULL
       WHEN NOT EXISTS (SELECT 1 FROM market_sessions WHERE exchange = 'US') THEN NULL
       ELSE (
         SELECT count(*)::integer
         FROM market_sessions ms
         WHERE ms.exchange = 'US'
           AND ms.session_date > s.first_sight_ts::date
           AND ms.session_date <= fr.event_ts::date
       )
  END AS stock_trading_sessions
FROM sightings s
LEFT JOIN first_recognition fr ON fr.sighting_id = s.sighting_id
WHERE s.backfilled = false;
