CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS methodology_versions (
  version text PRIMARY KEY,
  activated_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  notes text NOT NULL DEFAULT ''
);

INSERT INTO methodology_versions(version, notes)
VALUES ('LT-1.0', 'LT-1.0 code-enforced prospective first-sight ledger')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS sightings (
  sighting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL DEFAULT gen_random_uuid()::text,
  lane text NOT NULL DEFAULT 'STOCK' CHECK (lane IN ('STOCK','CRYPTO')),
  entity text NOT NULL,
  tradable_ticker text,
  venue text NOT NULL,
  venue_attention text NOT NULL CHECK (venue_attention IN ('LOW','HIGH')),
  source_url text NOT NULL,
  venue_url text,
  venue_published_ts timestamptz,
  first_sight_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_text text NOT NULL,
  claim_hash text NOT NULL,
  evidence_tier text NOT NULL CHECK (evidence_tier IN ('SIGNAL','PRECURSOR','REPORTED','VERIFIED')),
  mri_at_first_sight jsonb,
  methodology_version text NOT NULL REFERENCES methodology_versions(version),
  backfilled boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'jarvis-backend',
  UNIQUE(event_id, venue, claim_hash)
);

ALTER TABLE sightings
  ADD COLUMN IF NOT EXISTS venue_url text,
  ADD COLUMN IF NOT EXISTS mri_at_first_sight jsonb;
ALTER TABLE sightings
  ALTER COLUMN event_id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN lane SET DEFAULT 'STOCK';

CREATE TABLE IF NOT EXISTS recognition_events (
  recognition_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sighting_id uuid NOT NULL REFERENCES sightings(sighting_id),
  event_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS market_sessions (
  exchange text NOT NULL,
  session_date date NOT NULL,
  source_name text NOT NULL,
  loaded_ts timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(exchange, session_date)
);

CREATE INDEX IF NOT EXISTS sightings_lane_time_idx ON sightings(lane, first_sight_ts);
CREATE INDEX IF NOT EXISTS sightings_ticker_time_idx ON sightings(tradable_ticker, first_sight_ts);

CREATE OR REPLACE FUNCTION lt1_prepare_sighting() RETURNS trigger AS $$
BEGIN
  IF NEW.event_id IS NULL OR btrim(NEW.event_id) = '' THEN NEW.event_id := gen_random_uuid()::text; END IF;
  IF NEW.lane IS NULL OR btrim(NEW.lane) = '' THEN NEW.lane := 'STOCK'; END IF;
  IF NEW.source_url IS NULL OR btrim(NEW.source_url) = '' THEN NEW.source_url := NEW.venue_url; END IF;
  IF NEW.venue_url IS NULL OR btrim(NEW.venue_url) = '' THEN NEW.venue_url := NEW.source_url; END IF;
  IF NEW.source_url IS NULL OR btrim(NEW.source_url) = '' THEN RAISE EXCEPTION 'source_url or venue_url is required'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lt1_prepare_sighting_before_insert ON sightings;
CREATE TRIGGER lt1_prepare_sighting_before_insert BEFORE INSERT ON sightings
FOR EACH ROW EXECUTE FUNCTION lt1_prepare_sighting();

CREATE OR REPLACE FUNCTION lt1_sightings_update_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.first_sight_ts IS DISTINCT FROM OLD.first_sight_ts THEN RAISE EXCEPTION 'first_sight_ts is immutable'; END IF;
  RAISE EXCEPTION 'sightings is append-only; UPDATE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sightings_no_update ON sightings;
DROP TRIGGER IF EXISTS lt1_sightings_update_guard_trigger ON sightings;
CREATE TRIGGER lt1_sightings_update_guard_trigger BEFORE UPDATE ON sightings
FOR EACH ROW EXECUTE FUNCTION lt1_sightings_update_guard();

CREATE OR REPLACE FUNCTION lt1_sightings_delete_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.entity = 'TEST' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'sightings is append-only; DELETE is not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sightings_no_delete ON sightings;
DROP TRIGGER IF EXISTS lt1_sightings_delete_guard_trigger ON sightings;
CREATE TRIGGER lt1_sightings_delete_guard_trigger BEFORE DELETE ON sightings
FOR EACH ROW EXECUTE FUNCTION lt1_sightings_delete_guard();

DROP VIEW IF EXISTS lead_time_report;
CREATE VIEW lead_time_report AS
WITH first_recognition AS (
  SELECT DISTINCT ON (sighting_id) sighting_id, event_ts
  FROM recognition_events
  WHERE event_type = 'HIGH_ATTENTION_FIRST_SEEN'
  ORDER BY sighting_id, event_ts ASC
)
SELECT
  s.sighting_id, s.lane, s.venue, s.evidence_tier, s.first_sight_ts,
  fr.event_ts AS first_high_attention_ts,
  CASE WHEN fr.event_ts IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (fr.event_ts - s.first_sight_ts)) / 3600.0 END AS lead_time_hours,
  CASE WHEN s.lane <> 'STOCK' OR fr.event_ts IS NULL THEN NULL
       WHEN NOT EXISTS (SELECT 1 FROM market_sessions WHERE exchange = 'US') THEN NULL
       ELSE (SELECT count(*)::integer FROM market_sessions ms
             WHERE ms.exchange = 'US' AND ms.session_date > s.first_sight_ts::date AND ms.session_date <= fr.event_ts::date)
  END AS stock_trading_sessions
FROM sightings s
LEFT JOIN first_recognition fr ON fr.sighting_id = s.sighting_id
WHERE s.backfilled = false AND s.entity <> 'TEST';
