-- Documents an NGO must provide when requesting a service ("المرفقات المطلوبة"), as names only:
-- ["محاضر الجمعيات العمومية الأخيرة", ...]. Uploading them belongs to the requests module.
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS required_attachments JSONB NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(required_attachments) = 'array');
