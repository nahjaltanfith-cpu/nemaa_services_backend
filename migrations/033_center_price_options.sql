-- Centers get the same price options as services:
-- price NULL = no fixed price ("يحدد بعد الاجتماع"); the CHECK (price >= 0) still applies when set.
-- is_free = TRUE shows the center as free on the website while price keeps the original value.
ALTER TABLE enablement_centers ALTER COLUMN price DROP NOT NULL;
ALTER TABLE enablement_centers ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;
