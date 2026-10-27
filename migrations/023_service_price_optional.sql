-- A service may have no fixed price: NULL means "يحدد بعد الاجتماع" (set after the first
-- meeting). The CHECK (price >= 0) still applies to every price that is set.
ALTER TABLE services ALTER COLUMN price DROP NOT NULL;
