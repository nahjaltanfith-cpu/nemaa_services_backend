-- Media registry: one row per stored file (PDFs, images), whatever uses it.
-- The tables that use files keep their own keys / URLs (request_files.file_key, ngos.*_key, *.image_url,
-- *.avatar_url); this registry only describes the stored object and is reconciled from those columns:
--   pending  = uploaded, nothing uses it yet      attached = used by `owner_type` / `owner_id` as `usage`
--   orphaned = was used, no longer is             missing  = registered but not found in storage
--   deleted  = removed from storage (row kept for the audit trail)
-- Unused files (pending / orphaned) are removed from storage after a grace period.
CREATE TABLE IF NOT EXISTS media_files (
    id SERIAL PRIMARY KEY,
    storage_key VARCHAR(255) NOT NULL UNIQUE,
    provider VARCHAR(20) NOT NULL DEFAULT 'local',
    original_name VARCHAR(255),
    mime_type VARCHAR(100),
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256 CHAR(64),
    usage VARCHAR(30),
    owner_type VARCHAR(20),
    owner_id VARCHAR(64),
    uploaded_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    uploaded_by_ngo_id INTEGER REFERENCES ngos (id) ON DELETE SET NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'attached', 'orphaned', 'missing', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attached_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS media_files_status_size_idx ON media_files (status, size_bytes DESC);
CREATE INDEX IF NOT EXISTS media_files_owner_idx ON media_files (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS media_files_created_idx ON media_files (created_at DESC);
CREATE INDEX IF NOT EXISTS media_files_usage_idx ON media_files (usage);

-- Who may see the files page and delete files (super admins always can).
INSERT INTO permissions (key, label, description, group_key, sort_order) VALUES
    ('manage:files', 'إدارة الملفات', 'عرض كل الملفات المرفوعة ومساحتها، وحذف الملفات غير المستخدمة أو الثقيلة', 'admin', 50)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
    group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;
