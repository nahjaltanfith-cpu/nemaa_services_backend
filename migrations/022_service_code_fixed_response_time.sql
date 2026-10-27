-- Service code shown to NGOs and staff ("GOV-01"): letters, a dash, a number. Optional for the
-- services that predate it, unique once set.
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS code VARCHAR(20)
        CONSTRAINT services_code_format CHECK (code ~ '^[A-Z]{2,10}-[0-9]{1,4}$');
CREATE UNIQUE INDEX IF NOT EXISTS services_code_unique ON services (code);

-- Response time is the same for every service; the API no longer accepts it from the form.
ALTER TABLE services ALTER COLUMN response_time SET DEFAULT 'خلال يومي عمل';
UPDATE services SET response_time = 'خلال يومي عمل';
