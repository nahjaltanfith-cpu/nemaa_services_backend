-- Enablement centers (مراكز التمكين): turns the minimal `centers` table from 012 into the full
-- centers module, mirroring the services table. A center offers many services and a service can
-- be offered through many centers (center_services).
-- Ids stay slugs: the website already links to /centers/:id and services store these ids.
-- The migration runner executes this file in a transaction.

ALTER TABLE centers RENAME TO enablement_centers;
ALTER TABLE enablement_centers RENAME CONSTRAINT centers_pkey TO enablement_centers_pkey;
ALTER TABLE enablement_centers RENAME CONSTRAINT centers_id_check TO enablement_centers_id_check;

ALTER TABLE service_centers RENAME TO center_services;
ALTER TABLE center_services RENAME CONSTRAINT service_centers_pkey TO center_services_pkey;
-- FK names say which side is missing, so API errors can tell a bad center from a bad service.
ALTER TABLE center_services RENAME CONSTRAINT service_centers_center_id_fkey TO center_services_center_fkey;
ALTER TABLE center_services RENAME CONSTRAINT service_centers_service_id_fkey TO center_services_service_fkey;
ALTER INDEX service_centers_center_idx RENAME TO center_services_center_idx;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'center_status') THEN
        CREATE TYPE center_status AS ENUM ('active', 'inactive', 'coming_soon');
    END IF;
END $$;

ALTER TABLE enablement_centers
    ADD CONSTRAINT enablement_centers_title_check CHECK (char_length(btrim(title)) > 0),
    -- active: requestable · coming_soon: listed but not requestable · inactive: hidden from NGOs
    ADD COLUMN status center_status NOT NULL DEFAULT 'active',
    ADD COLUMN image_url VARCHAR(512),
    ADD COLUMN price DECIMAL(12, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    -- Average of reviews (0–5); reviews do not exist yet, so it is seeded/maintained directly.
    ADD COLUMN rating DECIMAL(3, 2) NOT NULL DEFAULT 0.00 CHECK (rating BETWEEN 0 AND 5),
    ADD COLUMN response_time VARCHAR(100),
    ADD COLUMN execution_duration VARCHAR(100),
    -- "نظرة عامة". Nullable only because the 012 rows predate it; the API requires it.
    ADD COLUMN overview TEXT,
    -- Card text; generated from the first two sentences/lines of overview when not provided.
    ADD COLUMN short_description TEXT,
    -- "المخرجات"
    ADD COLUMN outputs JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(outputs) = 'array'),
    -- Steps: [{ "title": "...", "description": "..." }], same shape as services.work_methodology.
    ADD COLUMN methodology JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(methodology) = 'array'),
    ADD COLUMN target_audience JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(target_audience) = 'array');

CREATE INDEX IF NOT EXISTS enablement_centers_status_idx ON enablement_centers (status);
