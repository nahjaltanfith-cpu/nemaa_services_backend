-- Admin review workflow for NGOs and the admin ↔ NGO conversation.
-- The migration runner executes this file in a transaction.

-- 'new': registered with complete documents, not yet picked up by an admin.
ALTER TABLE ngos DROP CONSTRAINT IF EXISTS ngos_account_status_check;
ALTER TABLE ngos ADD CONSTRAINT ngos_account_status_check
    CHECK (account_status IN ('new', 'under_review', 'needs_documents', 'approved'));

-- Feedback shown to the NGO (required when an admin asks for completion).
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS admin_notes TEXT;
-- An NGO has an unseen status update while status_updated_at > status_seen_at (or seen is NULL).
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMP;
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS status_seen_at TIMESTAMP;
-- Admins can close a conversation; the NGO can read it but not send while closed.
ALTER TABLE ngos ADD COLUMN IF NOT EXISTS conversation_open BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS ngo_messages (
    id SERIAL PRIMARY KEY,
    ngo_id INTEGER NOT NULL REFERENCES ngos (id) ON DELETE CASCADE,
    sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('admin', 'ngo')),
    -- users.id of the admin who wrote it; NULL for NGO messages.
    sender_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Set when the other side has read the message.
    read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ngo_messages_thread_idx ON ngo_messages (ngo_id, created_at);
CREATE INDEX IF NOT EXISTS ngo_messages_unread_idx ON ngo_messages (ngo_id, sender_type) WHERE read_at IS NULL;
