-- Parts of a center that are not separate catalog services (they can't be requested on their own):
-- shown only in the center's definition, never in the services list. [{ title, description }].
-- The migration runner executes this file in a transaction.
ALTER TABLE enablement_centers
    ADD COLUMN IF NOT EXISTS extra_services JSONB NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(extra_services) = 'array');
