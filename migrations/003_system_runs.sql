CREATE TABLE IF NOT EXISTS system_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_ts timestamptz NOT NULL,
  finished_ts timestamptz NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('MANUAL','HOURLY','TEST')),
  implementation text NOT NULL,
  complete boolean NOT NULL,
  results jsonb NOT NULL,
  created_ts timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS system_runs_finished_idx ON system_runs(finished_ts DESC);

DROP TRIGGER IF EXISTS system_runs_no_update ON system_runs;
CREATE TRIGGER system_runs_no_update
  BEFORE UPDATE ON system_runs
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

DROP TRIGGER IF EXISTS system_runs_no_delete ON system_runs;
CREATE TRIGGER system_runs_no_delete
  BEFORE DELETE ON system_runs
  FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE OR REPLACE VIEW latest_system_run AS
SELECT *
FROM system_runs
ORDER BY finished_ts DESC
LIMIT 1;
