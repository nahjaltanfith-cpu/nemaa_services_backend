-- The activity log answers "when exactly": store the moment with its time zone, so the dashboard
-- shows the right day and hour wherever the server or the viewer is. Existing rows were written
-- in the database's time zone.
-- The migration runner executes this file in a transaction.
ALTER TABLE activity_log
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE current_setting('TimeZone'),
    ALTER COLUMN created_at SET DEFAULT NOW();
