-- When the NGO last opened the request page. A team update after it (status change, timeline
-- note, deliverables) is shown to the NGO as "تحديث جديد" until it opens the request again.
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS ngo_seen_at TIMESTAMP;
