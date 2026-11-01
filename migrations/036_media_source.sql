-- Where a registry row came from: 'upload' = registered when it was uploaded, 'scan' = found in storage
-- by the sync (files that existed before the registry). Only uploads and files released after tracking
-- are cleaned up automatically; unused 'scan' files wait for an admin's decision on the files page.
ALTER TABLE media_files ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'scan'));
-- Rows the first sync found before this column existed
UPDATE media_files SET source = 'scan' WHERE uploaded_by_user_id IS NULL AND uploaded_by_ngo_id IS NULL AND sha256 IS NOT NULL
    AND created_at < (SELECT MIN(applied_at) FROM schema_migrations WHERE filename = '035_media_files.sql');
