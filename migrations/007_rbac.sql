-- The migration runner executes this file in a transaction.
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO roles (name, description) VALUES
    ('admin', 'Full system access'),
    ('user', 'Standard access'),
    ('SUPER_ADMIN', 'Legacy full system access'),
    ('EMPLOYEE', 'Legacy employee access')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER;

-- Preserve existing role names, user IDs, passwords and all other user fields.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users' AND column_name = 'role'
    ) THEN
        EXECUTE 'INSERT INTO roles (name)
                 SELECT DISTINCT role::text FROM users WHERE role IS NOT NULL
                 ON CONFLICT (name) DO NOTHING';
        EXECUTE 'UPDATE users u SET role_id = r.id
                 FROM roles r WHERE r.name = u.role::text';
    END IF;
END
$$;

UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'user')
WHERE role_id IS NULL;

ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'users'::regclass
          AND c.contype = 'f' AND a.attname = 'role_id'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_id_fkey
            FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users (role_id);

-- No CASCADE: dependent legacy views must be updated explicitly before migration.
ALTER TABLE users DROP COLUMN IF EXISTS role;
