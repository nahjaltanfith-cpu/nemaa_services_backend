-- Staff management on top of 007_rbac (roles + users.role_id): super-admin roles, active/inactive
-- staff accounts, and a permission catalog that roles are mapped to.
-- The migration runner executes this file in a transaction.

-- ── Roles ───────────────────────────────────────────────────────────────────
ALTER TABLE roles
    -- Name shown in the dashboard (roles.name stays the stable key carried by JWTs).
    ADD COLUMN IF NOT EXISTS label VARCHAR(100),
    -- Full, unrestricted access: bypasses every permission check, manages staff.
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Can be assigned to dashboard staff. 'user' (public sign-ups) is the only non-staff role.
    ADD COLUMN IF NOT EXISTS is_staff BOOLEAN NOT NULL DEFAULT TRUE,
    -- Built-in roles the app relies on; not renamable or deletable from the UI.
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE roles SET label = 'مدير النظام', is_super_admin = TRUE, is_system = TRUE,
    description = 'صلاحيات كاملة على كل أقسام لوحة التحكم وإدارة فريق العمل'
WHERE name = 'SUPER_ADMIN';
UPDATE roles SET label = 'مسؤول', is_super_admin = TRUE, is_system = TRUE,
    description = 'صلاحيات كاملة (اسم الدور القديم للمسؤول)'
WHERE name = 'admin';
UPDATE roles SET label = 'موظف', is_system = TRUE,
    description = 'موظف بدون صلاحيات إدارية — تُضاف صلاحياته لاحقًا'
WHERE name = 'EMPLOYEE';
UPDATE roles SET label = 'مستخدم', is_staff = FALSE, is_system = TRUE,
    description = 'حسابات التسجيل العام — ليست من فريق العمل'
WHERE name = 'user';

INSERT INTO roles (name, label, description, is_system) VALUES
    ('REVIEWER', 'مراجع الطلبات', 'مراجعة طلبات الجمعيات واعتماد حساباتها والتواصل معها', TRUE),
    ('CONTENT_MANAGER', 'مدير المحتوى', 'إدارة الخدمات ومراكز التمكين والتصنيفات', TRUE)
ON CONFLICT (name) DO NOTHING;

UPDATE roles SET label = name WHERE label IS NULL;
ALTER TABLE roles ALTER COLUMN label SET NOT NULL;

-- ── Permissions (mapped to roles; super-admin roles need no rows) ───────────
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    -- Checked in code with requirePermission('<key>'): '<area>.<action>'.
    key VARCHAR(100) NOT NULL UNIQUE CHECK (key ~ '^[a-z]+(\.[a-z_]+)+$'),
    label VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx ON role_permissions (permission_id);

INSERT INTO permissions (key, label, description) VALUES
    ('requests.manage', 'إدارة الطلبات', 'مراجعة طلبات الجمعيات وتغيير حالتها ورفع ملفات التسليم والمحادثة عليها'),
    ('ngos.review', 'مراجعة الجمعيات', 'اعتماد حسابات الجمعيات وطلب المستندات والمحادثة معها'),
    ('catalog.manage', 'إدارة الكتالوج', 'إضافة وتعديل الخدمات والمراكز والتصنيفات'),
    ('staff.manage', 'إدارة فريق العمل', 'إضافة الموظفين وتعديل أدوارهم وإيقاف حساباتهم')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
    (r.name = 'REVIEWER' AND p.key IN ('requests.manage', 'ngos.review'))
    OR (r.name = 'CONTENT_MANAGER' AND p.key = 'catalog.manage')
ON CONFLICT DO NOTHING;

-- ── Staff accounts (users) ──────────────────────────────────────────────────
ALTER TABLE users
    -- Deactivated staff can't sign in and their existing tokens stop working immediately.
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Emails are compared lowercased at login; keep them unique that way too.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (LOWER(email));
