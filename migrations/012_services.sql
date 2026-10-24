-- Services catalog, the centers they can be offered through, and the link between them.
-- The migration runner executes this file in a transaction.

-- Enablement centers. Only what services need for now (id + title); the centers module
-- will extend this table. ids are the slugs the frontend already uses in /centers/:id.
CREATE TABLE IF NOT EXISTS centers (
    id VARCHAR(100) PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_status') THEN
        CREATE TYPE service_status AS ENUM ('active', 'inactive', 'coming_soon');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL CHECK (char_length(btrim(title)) > 0),
    -- active: requestable · coming_soon: listed but not requestable · inactive: hidden from NGOs
    status service_status NOT NULL DEFAULT 'active',
    image_url VARCHAR(512),
    price DECIMAL(12, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    -- Incremented atomically when an NGO submits a request (see incrementRequestCount).
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    -- Average of reviews (0–5); reviews do not exist yet, so it is seeded/maintained directly.
    rating DECIMAL(3, 2) NOT NULL DEFAULT 0.00 CHECK (rating BETWEEN 0 AND 5),
    response_time VARCHAR(100),
    -- Shown in the details page ("مدة التنفيذ"); not in the original spec but used by the UI.
    duration VARCHAR(100),
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    full_description TEXT NOT NULL CHECK (char_length(btrim(full_description)) > 0),
    -- Generated from the first two sentences/lines of full_description when not provided.
    short_description TEXT,
    outputs JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(outputs) = 'array'),
    -- Steps: [{ "title": "...", "description": "..." }] (description may be empty).
    work_methodology JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(work_methodology) = 'array'),
    target_audience JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(target_audience) = 'array'),
    -- "ما يشمله" list in the details page; same reason as duration.
    includes JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(includes) = 'array'),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS services_category_idx ON services (category_id);
CREATE INDEX IF NOT EXISTS services_status_idx ON services (status);

CREATE TABLE IF NOT EXISTS service_centers (
    service_id INTEGER NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    center_id VARCHAR(100) NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, center_id)
);

CREATE INDEX IF NOT EXISTS service_centers_center_idx ON service_centers (center_id);
