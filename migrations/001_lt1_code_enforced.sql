CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS methodology_versions (
  version text PRIMARY KEY,
  activated_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  notes text NOT NULL
);

INSERT INTO methodology_versions(version, notes)
VALUES ('LT-1.0-CODE', 'Code-enforced sightings ledger. Prospective credit begins only when this migration is applied to production Postgres.')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS sightings (
  sighting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  lane text NOT NULL CHECK (lane IN ('STOCK','CRYPTO')),
  entity text NOT NULL,
  tradable_ticker text,
  venue text NOT NULL,
  venue_attention text NOT NULL CHECK (venue_attention IN ('LOW','HIGH')),
  source_url text NOT NULL,
  venue_published_ts timestamptz,
  first_sight_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_text text NOT NULL,
  claim_hash text NOT NULL,
  evidence_tier text NOT NULL CHECK (evidence_tier IN ('SIGNAL','PRECURSOR','REPORTED','VERIFIED')),
  methodology_version text NOT NULL REFERENCES methodology_versions(version),
  backfilled boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'jarvis-backend',
  UNIQUE(event_id, venue, claim_hash)
);

CREATE INDEX IF NOT EXISTS sightings_lane_time_idx ON sightings(lane, first_sight_ts);
CREATE INDEX IF NOT EXISTS sightings_ticker_time_idx ON sightings(tradable_ticker, first_sight_ts);

CREATE TABLE IF NOT EXISTS market_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sighting_id uuid NOT NULL REFERENCES sightings(sighting_id),
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

CREATE INDEX IF NOT EXISTS market_snapshots_sighting_time_idx ON market_snapshots(sighting_id, captured_ts);

CREATE TABLE IF NOT EXISTS beneficiary_resolutions (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sighting_id uuid NOT NULL REFERENCES sightings(sighting_id),
  assessed_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  catalyst_entity text NOT NULL,
  beneficiary_ticker text NOT NULL,
  relationship_amount_usd numeric,
  beneficiary_revenue_usd numeric,
  beneficiary_segment_revenue_usd numeric,
  materiality_ratio_total_revenue numeric,
  materiality_ratio_segment_revenue numeric,
  qualitative_materiality text,
  materiality_status text NOT NULL CHECK (materiality_status IN ('PASS','FAIL','UNRESOLVED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text
);

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sighting_id uuid NOT NULL REFERENCES sightings(sighting_id),
  assessment_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  jarvis_state text NOT NULL CHECK (jarvis_state IN ('GREEN','YELLOW','RED')),
  argus_recognition text NOT NULL CHECK (argus_recognition IN ('GREEN','YELLOW','RED','UNMEASURED')),
  argus_execution text NOT NULL CHECK (argus_execution IN ('GREEN','YELLOW','RED','UNMEASURED')),
  sentinel_state text NOT NULL CHECK (sentinel_state IN ('GREEN','YELLOW','RED','UNMEASURED')),
  stage text NOT NULL,
  materiality_reason text,
  failed_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  recognition_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL,
  created_by text NOT NULL DEFAULT 'jarvis-backend'
);

CREATE TABLE IF NOT EXISTS recognition_events (
  recognition_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sighting_id uuid NOT NULL REFERENCES sightings(sighting_id),
  event_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL CHECK (event_type IN ('HIGH_ATTENTION_FIRST_SEEN','PRICE_RECOGNITION_ONSET','INVALIDATION')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS adapter_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter text NOT NULL,
  started_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_ts timestamptz,
  items_seen integer NOT NULL DEFAULT 0,
  items_new integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
  error text
);

CREATE OR REPLACE FUNCTION reject_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sightings_no_update ON sightings;
CREATE TRIGGER sightings_no_update BEFORE UPDATE ON sightings FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS sightings_no_delete ON sightings;
CREATE TRIGGER sightings_no_delete BEFORE DELETE ON sightings FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

DROP TRIGGER IF EXISTS market_snapshots_no_update ON market_snapshots;
CREATE TRIGGER market_snapshots_no_update BEFORE UPDATE ON market_snapshots FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS market_snapshots_no_delete ON market_snapshots;
CREATE TRIGGER market_snapshots_no_delete BEFORE DELETE ON market_snapshots FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

DROP TRIGGER IF EXISTS beneficiary_resolutions_no_update ON beneficiary_resolutions;
CREATE TRIGGER beneficiary_resolutions_no_update BEFORE UPDATE ON beneficiary_resolutions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS beneficiary_resolutions_no_delete ON beneficiary_resolutions;
CREATE TRIGGER beneficiary_resolutions_no_delete BEFORE DELETE ON beneficiary_resolutions FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

DROP TRIGGER IF EXISTS assessments_no_update ON assessments;
CREATE TRIGGER assessments_no_update BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS assessments_no_delete ON assessments;
CREATE TRIGGER assessments_no_delete BEFORE DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

DROP TRIGGER IF EXISTS recognition_events_no_update ON recognition_events;
CREATE TRIGGER recognition_events_no_update BEFORE UPDATE ON recognition_events FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
DROP TRIGGER IF EXISTS recognition_events_no_delete ON recognition_events;
CREATE TRIGGER recognition_events_no_delete BEFORE DELETE ON recognition_events FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE OR REPLACE VIEW sightings_with_t0_snapshot AS
SELECT
  s.*,
  ms.snapshot_id,
  ms.captured_ts,
  ms.price,
  ms.ret_5d,
  ms.ret_20d,
  ms.volume_ratio_5d_90d,
  ms.news_count_7d,
  ms.analyst_count,
  ms.source_name AS market_source_name,
  ms.source_kind AS market_source_kind,
  ms.status AS snapshot_status,
  CASE
    WHEN s.backfilled THEN false
    WHEN s.first_sight_ts < mv.activated_ts THEN false
    WHEN ms.snapshot_id IS NULL THEN false
    WHEN ms.source_kind NOT IN ('API','CONNECTOR') THEN false
    WHEN ms.status = 'FAILED' THEN false
    WHEN ms.captured_ts < s.first_sight_ts THEN false
    WHEN ms.captured_ts > s.first_sight_ts + interval '5 minutes' THEN false
    ELSE true
  END AS alpha_eligible
FROM sightings s
JOIN methodology_versions mv ON mv.version = s.methodology_version
LEFT JOIN LATERAL (
  SELECT m.*
  FROM market_snapshots m
  WHERE m.sighting_id = s.sighting_id
  ORDER BY m.captured_ts ASC
  LIMIT 1
) ms ON true;

CREATE OR REPLACE VIEW lead_time_report AS
SELECT
  s.lane,
  s.venue,
  s.evidence_tier,
  count(*) AS sightings,
  count(*) FILTER (WHERE e.event_type = 'HIGH_ATTENTION_FIRST_SEEN') AS later_high_attention,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (e.event_ts - s.first_sight_ts)) / 3600.0
  ) FILTER (WHERE e.event_type = 'HIGH_ATTENTION_FIRST_SEEN') AS median_lead_hours
FROM sightings s
LEFT JOIN recognition_events e ON e.sighting_id = s.sighting_id
WHERE s.backfilled = false
GROUP BY s.lane, s.venue, s.evidence_tier;
