-- Service categories. Each service will belong to exactly one category.
-- The migration runner executes this file in a transaction.
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (char_length(btrim(name)) > 0),
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Names are unique regardless of case and surrounding spaces ("Health" = "health ").
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique ON categories (lower(btrim(name)));

-- Service ↔ category relationship (services table does not exist yet).
-- When it is created, give it:
--     category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT
-- RESTRICT keeps a category from being deleted while services use it; the API maps that
-- error to 409 CATEGORY_IN_USE. If the table already exists, the column is added here.
DO $$
BEGIN
    IF to_regclass('public.services') IS NOT NULL THEN
        ALTER TABLE services ADD COLUMN IF NOT EXISTS category_id INTEGER
            REFERENCES categories (id) ON DELETE RESTRICT;
        CREATE INDEX IF NOT EXISTS services_category_idx ON services (category_id);
    END IF;
END $$;
