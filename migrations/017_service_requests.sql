-- NGO requests for a service or an enablement center, with their files, status history,
-- missing-document rounds ("بحاجة إلى استكمال") and a conversation per request.
-- The migration runner executes this file in a transaction.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
        -- draft: saved by the NGO, not sent · under_study → needs_completion ⇄ under_study → in_progress → completed
        CREATE TYPE request_status AS ENUM ('draft', 'under_study', 'needs_completion', 'in_progress', 'completed');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_requests (
    id SERIAL PRIMARY KEY,
    -- DRAFT-XXXXXXXX while a draft, REQ-XXXXXXXX once submitted (same suffix).
    ref_code VARCHAR(20) NOT NULL UNIQUE,
    ngo_id INTEGER NOT NULL REFERENCES ngos (id) ON DELETE CASCADE,
    -- NULL only on drafts that have no target picked yet.
    target_type VARCHAR(10) CHECK (target_type IN ('service', 'center')),
    service_id INTEGER REFERENCES services (id) ON DELETE SET NULL,
    center_id VARCHAR(100) REFERENCES enablement_centers (id) ON DELETE SET NULL,
    -- Title at request time, so the request still reads right if the service is renamed or deleted.
    target_name VARCHAR(255) NOT NULL DEFAULT '',
    need_title VARCHAR(255) NOT NULL,
    summary VARCHAR(500) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    contact_method VARCHAR(10) NOT NULL DEFAULT 'call' CHECK (contact_method IN ('call', 'meeting', 'session')),
    status request_status NOT NULL DEFAULT 'draft',
    -- Admin's explanation shown to the NGO while the request needs completion.
    completion_note TEXT,
    submitted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (
        (target_type = 'service' AND center_id IS NULL)
        OR (target_type = 'center' AND service_id IS NULL)
        OR (target_type IS NULL AND service_id IS NULL AND center_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS service_requests_ngo_idx ON service_requests (ngo_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests (status, updated_at DESC);

-- Documents the admin asked for in a "needs completion" round; fulfilled when the NGO uploads it.
CREATE TABLE IF NOT EXISTS request_missing_items (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests (id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL CHECK (char_length(btrim(name)) > 0),
    fulfilled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_missing_items_request_idx ON request_missing_items (request_id);

-- Every file on a request. kind: ngo = sent with the request · completion = answer to a missing
-- item · deliverable = final result uploaded by Nemaa's team.
CREATE TABLE IF NOT EXISTS request_files (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests (id) ON DELETE CASCADE,
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('ngo', 'completion', 'deliverable')),
    -- Required-document name (or missing item name) this file answers; NULL for extra files.
    label VARCHAR(500),
    required BOOLEAN NOT NULL DEFAULT FALSE,
    missing_item_id INTEGER REFERENCES request_missing_items (id) ON DELETE SET NULL,
    file_key VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
    uploaded_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_files_request_idx ON request_files (request_id, kind);

-- "سجل الحالة": one row per status change or note, shown to the NGO.
CREATE TABLE IF NOT EXISTS request_status_log (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests (id) ON DELETE CASCADE,
    status request_status NOT NULL,
    label VARCHAR(255) NOT NULL,
    note TEXT,
    actor_type VARCHAR(10) NOT NULL CHECK (actor_type IN ('admin', 'ngo')),
    actor_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_status_log_request_idx ON request_status_log (request_id, created_at);

-- Conversation about one request, separate from the general admin ↔ NGO thread.
CREATE TABLE IF NOT EXISTS request_messages (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests (id) ON DELETE CASCADE,
    sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('admin', 'ngo')),
    sender_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS request_messages_thread_idx ON request_messages (request_id, created_at);
CREATE INDEX IF NOT EXISTS request_messages_unread_idx ON request_messages (request_id, sender_type) WHERE read_at IS NULL;
