-- Admin-editable platform settings (one JSON value per key).
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Upload exceptions: request attachments and deliverables may go beyond the default
-- (PDF up to 5 MB) when the uploader confirms, within these limits.
INSERT INTO app_settings (key, value)
VALUES ('upload_exceptions', '{"enabled": true, "maxMb": 20, "types": ["docx", "xlsx", "pptx", "ai"]}')
ON CONFLICT (key) DO NOTHING;

-- Files uploaded as an exception are marked in the files page
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS is_exception BOOLEAN NOT NULL DEFAULT FALSE;
