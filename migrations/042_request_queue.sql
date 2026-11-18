-- Waiting list (قائمة الانتظار) for services and centers with a maximum number of beneficiaries.
-- A request submitted while the target is full is no longer refused: it is stored as 'queued',
-- holds no place, and moves to 'under_study' on its own (oldest first) as soon as a place frees up.
-- The migration runner executes this file in a transaction: ADD VALUE inside one needs PostgreSQL 12+,
-- and the new value can't be used in this same transaction (so no partial index on it here).

ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'queued' BEFORE 'under_study';

-- 'system': timeline entries nobody typed, e.g. "the request left the waiting list".
ALTER TABLE request_status_log DROP CONSTRAINT IF EXISTS request_status_log_actor_type_check;
ALTER TABLE request_status_log
    ADD CONSTRAINT request_status_log_actor_type_check CHECK (actor_type IN ('admin', 'ngo', 'system'));
