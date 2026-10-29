-- A priced service can be offered free for a while (e.g. the launch period) without losing its price:
-- is_free = TRUE shows it as free on the website while price keeps the original value.
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;
