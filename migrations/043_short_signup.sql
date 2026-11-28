-- Short sign-up: an NGO registers with its name, registration number, email, mobile and password,
-- then completes the field of work, region, representative and documents from its profile.
ALTER TABLE ngos ALTER COLUMN field_of_work DROP NOT NULL;
ALTER TABLE ngos ALTER COLUMN representative_name DROP NOT NULL;
