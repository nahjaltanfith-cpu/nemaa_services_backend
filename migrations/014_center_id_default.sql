-- New centers get their id from the database ("center-1", "center-2", ...) instead of the admin
-- typing a slug. The seeded centers keep their readable ids so existing links stay valid.
CREATE SEQUENCE IF NOT EXISTS enablement_centers_id_seq OWNED BY enablement_centers.id;

ALTER TABLE enablement_centers
    ALTER COLUMN id SET DEFAULT 'center-' || nextval('enablement_centers_id_seq');
