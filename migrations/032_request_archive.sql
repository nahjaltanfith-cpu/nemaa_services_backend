-- Archiving a submitted request (super admin): it disappears from the dashboard and from the NGO,
-- but the row and everything attached to it (files, messages, history) stay for the record.
ALTER TABLE service_requests
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
