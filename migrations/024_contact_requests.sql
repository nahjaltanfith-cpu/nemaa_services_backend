-- Messages from the public "تواصل معنا" form. The team follows each one up from the dashboard by
-- moving it pending → contacted → completed; there are no threads or replies here.
-- The migration runner executes this file in a transaction.
CREATE TABLE IF NOT EXISTS contact_requests (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL DEFAULT 'general'
        CHECK (type IN ('general', 'technical', 'suggestion', 'partnership')),
    full_name VARCHAR(255) NOT NULL CHECK (char_length(btrim(full_name)) > 0),
    organization_name VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    -- Mobile / WhatsApp.
    phone VARCHAR(50),
    message TEXT NOT NULL CHECK (char_length(btrim(message)) > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'contacted', 'completed')),
    -- With time zone, like activity_log (021): the dashboard shows the right day and hour.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_requests_created_idx ON contact_requests (created_at DESC, id DESC);
-- The per-email throttle on the public form looks up recent messages by address.
CREATE INDEX IF NOT EXISTS contact_requests_email_idx ON contact_requests (lower(email), created_at DESC);

-- Who may read the messages and change their status (super admins always can).
INSERT INTO permissions (key, label, description, group_key, sort_order) VALUES
    ('manage:contact_requests', 'متابعة رسائل تواصل معنا', 'عرض رسائل نموذج تواصل معنا وتغيير حالة متابعتها', 'admin', 40)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
    group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;
