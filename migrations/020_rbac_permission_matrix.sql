-- Permission matrix on top of 019: fine-grained action keys ('<verb>:<object>') replace the four
-- area keys, roles get a request scope (which services/centers, assigned-only), requests get an
-- assignee, and staff actions go to an activity log.
-- The migration runner executes this file in a transaction.

-- ── Permission catalog ──────────────────────────────────────────────────────
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_key_check;
ALTER TABLE permissions
    -- Section of the role editor the action is listed under.
    ADD COLUMN IF NOT EXISTS group_key VARCHAR(30) NOT NULL DEFAULT 'admin'
        CHECK (group_key IN ('ngos', 'requests', 'catalog', 'admin')),
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

INSERT INTO permissions (key, label, description, group_key, sort_order) VALUES
    ('read:org_docs', 'الاطلاع على بيانات ومستندات الجمعيات', 'عرض ملفات الجمعيات ومستنداتها ومحادثاتها', 'ngos', 10),
    ('approve:org_accounts', 'اعتماد حسابات الجمعيات', 'تغيير حالة حساب الجمعية وطلب المستندات والمراسلة', 'ngos', 20),
    ('read:orders', 'الاطلاع على الطلبات', 'عرض الطلبات داخل نطاق الدور', 'requests', 10),
    ('assign:orders', 'إسناد الطلبات', 'إسناد الطلب إلى مختص أو إلغاء الإسناد', 'requests', 20),
    ('request:order_info', 'طلب استكمال الطلب', 'إرجاع الطلب للجمعية لاستكمال مستندات أو معلومات', 'requests', 30),
    ('approve:service_orders', 'اعتماد طلبات الخدمة', 'اعتماد الطلب وبدء العمل عليه أو إعادته للدراسة', 'requests', 40),
    ('execute:orders', 'معالجة وتنفيذ الطلبات', 'يمكن إسناد الطلبات إليه لتنفيذها', 'requests', 50),
    ('document:updates', 'توثيق التواصل والتحديثات', 'إضافة تحديثات على سجل الطلب ومراسلة الجمعية', 'requests', 60),
    ('upload:results', 'رفع المخرجات', 'رفع ملفات التسليم وحذفها', 'requests', 70),
    ('complete:order', 'تسليم النتيجة وإنهاء الطلب', 'نقل الطلب إلى حالة مكتمل', 'requests', 80),
    ('manage:catalog', 'إدارة الخدمات والمجالات والمراكز', 'إضافة وتعديل وحذف الخدمات والمراكز والتصنيفات', 'catalog', 10),
    ('manage:pricing', 'تعديل الأسعار والإعفاءات', 'تعديل سعر الخدمة أو المركز', 'catalog', 20),
    ('manage:form_configs', 'إدارة متطلبات النموذج والإقرارات', 'تعديل المرفقات المطلوبة في نموذج طلب الخدمة', 'catalog', 30),
    ('manage:employees', 'إدارة الموظفين', 'إضافة الموظفين وتعديل أدوارهم وإيقاف حساباتهم', 'admin', 10),
    ('manage:roles', 'إدارة الأدوار والصلاحيات', 'إنشاء المسميات الوظيفية وتحديد صلاحياتها ونطاقها', 'admin', 20),
    ('read:activity_log', 'الاطلاع على سجل النشاط', 'عرض سجل إجراءات فريق العمل', 'admin', 30)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
    group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;

-- Roles keep what they could do: every old area key maps to the actions it covered.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, np.id
FROM role_permissions rp
JOIN permissions op ON op.id = rp.permission_id
JOIN (VALUES
    ('requests.manage', 'read:orders'), ('requests.manage', 'assign:orders'),
    ('requests.manage', 'request:order_info'), ('requests.manage', 'approve:service_orders'),
    ('requests.manage', 'execute:orders'), ('requests.manage', 'document:updates'),
    ('requests.manage', 'upload:results'), ('requests.manage', 'complete:order'),
    ('ngos.review', 'read:org_docs'), ('ngos.review', 'approve:org_accounts'),
    ('catalog.manage', 'manage:catalog'), ('catalog.manage', 'manage:pricing'),
    ('catalog.manage', 'manage:form_configs'),
    ('staff.manage', 'manage:employees')
) AS m (old_key, new_key) ON m.old_key = op.key
JOIN permissions np ON np.key = m.new_key
ON CONFLICT DO NOTHING;

DELETE FROM permissions WHERE key IN ('requests.manage', 'ngos.review', 'catalog.manage', 'staff.manage');
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^[a-z]+:[a-z_]+$');

-- ── Role scope ──────────────────────────────────────────────────────────────
ALTER TABLE roles
    -- all_services · specific_services (role_services) · specific_centers (role_centers).
    ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20) NOT NULL DEFAULT 'all_services'
        CHECK (scope_type IN ('all_services', 'specific_services', 'specific_centers')),
    -- Only requests assigned to the user (inside the scope above).
    ADD COLUMN IF NOT EXISTS assigned_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS role_services (
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, service_id)
);

CREATE TABLE IF NOT EXISTS role_centers (
    role_id INTEGER NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    center_id VARCHAR(100) NOT NULL REFERENCES enablement_centers (id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (role_id, center_id)
);

-- ── Request assignment ──────────────────────────────────────────────────────
ALTER TABLE service_requests
    ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS service_requests_assignee_idx ON service_requests (assigned_to_user_id);

-- ── Activity log (staff actions; read with read:activity_log) ───────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    -- '<area>.<verb>', e.g. 'request.assign', 'role.update', 'staff.create'.
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id VARCHAR(100),
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx ON activity_log (entity_type, entity_id);
