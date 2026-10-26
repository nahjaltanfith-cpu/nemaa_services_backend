import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { P } from '../config/permissions.js';

// Usage: [SEED_STAFF_PASSWORD=...] npm run seed:rbac   (after npm run migrate and seed:services / seed:centers)
// Sample job titles with their permission matrix and scope, plus one demo employee (or two) per
// title. Safe to re-run: roles are matched by name, employees by email (their password is reset).
const PASSWORD = process.env.SEED_STAFF_PASSWORD || '12345678';

// The service the specialist role is scoped to; created when the catalog does not have it yet.
const SPECIALIST_SERVICE = 'جلسة استشارية متخصصة';

const ROLES = [
    {
        name: 'PLATFORM_ADMIN', label: 'مسؤول المنصة',
        description: 'كل الإجراءات على كل الخدمات والمراكز',
        permissions: Object.values(P), scopeType: 'all_services',
    },
    {
        name: 'NGO_ACCREDITATION_OFFICER', label: 'مسؤول اعتماد الجمعيات',
        description: 'مراجعة ملفات الجمعيات ومستنداتها واعتماد حساباتها',
        permissions: [P.READ_ORG_DOCS, P.APPROVE_ORG_ACCOUNTS], scopeType: 'all_services',
    },
    {
        name: 'REQUEST_COORDINATOR', label: 'منسق الطلبات',
        description: 'استقبال الطلبات وإسنادها للمختصين وطلب الاستكمال من الجمعيات',
        permissions: [P.READ_ORG_DOCS, P.READ_ORDERS, P.ASSIGN_ORDERS, P.REQUEST_ORDER_INFO, P.DOCUMENT_UPDATES],
        scopeType: 'all_services',
    },
    {
        name: 'ORDER_APPROVER', label: 'صاحب صلاحية اعتماد الطلبات',
        description: 'اعتماد طلبات الخدمة قبل بدء التنفيذ',
        permissions: [P.READ_ORG_DOCS, P.READ_ORDERS, P.REQUEST_ORDER_INFO, P.APPROVE_SERVICE_ORDERS],
        scopeType: 'all_services',
    },
    {
        name: 'SERVICE_SPECIALIST', label: 'مختص الخدمة',
        description: 'تنفيذ الطلبات المسندة إليه في خدماته ورفع المخرجات وتسليمها',
        permissions: [P.READ_ORDERS, P.EXECUTE_ORDERS, P.DOCUMENT_UPDATES, P.UPLOAD_RESULTS, P.COMPLETE_ORDER],
        scopeType: 'specific_services', assignedOnly: true, services: [SPECIALIST_SERVICE, 'استشارات مؤسسية'],
    },
    {
        name: 'CATALOG_MANAGER', label: 'مسؤول الكتالوج',
        description: 'إدارة الخدمات والمجالات والمراكز ومتطلبات نماذج الطلب',
        permissions: [P.MANAGE_CATALOG, P.MANAGE_FORM_CONFIGS], scopeType: 'all_services',
    },
    {
        name: 'FINANCIAL_ADVISOR', label: 'مستشار مالي',
        description: 'تنفيذ طلبات مركز العمليات المالية المسندة إليه وتعديل الأسعار',
        permissions: [P.READ_ORDERS, P.EXECUTE_ORDERS, P.DOCUMENT_UPDATES, P.UPLOAD_RESULTS, P.MANAGE_PRICING],
        scopeType: 'specific_centers', assignedOnly: true, centers: ['financial-operations'],
    },
];

const EMPLOYEES = [
    { name: 'سارة العتيبي', email: 'platform.admin@nemaa.local', role: 'PLATFORM_ADMIN' },
    { name: 'خالد الشهري', email: 'accreditation@nemaa.local', role: 'NGO_ACCREDITATION_OFFICER' },
    { name: 'نورة القحطاني', email: 'coordinator@nemaa.local', role: 'REQUEST_COORDINATOR' },
    { name: 'عبدالله الدوسري', email: 'approver@nemaa.local', role: 'ORDER_APPROVER' },
    { name: 'محمد الحربي', email: 'specialist@nemaa.local', role: 'SERVICE_SPECIALIST' },
    { name: 'ريم السبيعي', email: 'specialist2@nemaa.local', role: 'SERVICE_SPECIALIST' },
    { name: 'فهد المطيري', email: 'catalog@nemaa.local', role: 'CATALOG_MANAGER' },
    { name: 'هند الزهراني', email: 'finance@nemaa.local', role: 'FINANCIAL_ADVISOR' },
];

const ensureSpecialistService = async (client) => {
    const { rows } = await client.query('SELECT id FROM services WHERE title = $1', [SPECIALIST_SERVICE]);
    if (rows.length) return;
    const { rows: [created] } = await client.query(
        `INSERT INTO services (title, status, price, response_time, duration, category_id, full_description, short_description)
         VALUES ($1, 'active', 0, 'خلال يومي عمل', 'جلسة واحدة (90 دقيقة)',
                 (SELECT category_id FROM services WHERE title = 'استشارات مؤسسية'),
                 $2, $3)
         RETURNING id`,
        [SPECIALIST_SERVICE,
            'جلسة استشارية فردية مع مختص في المجال الذي تحدده الجمعية، لمراجعة تحدٍّ محدد والخروج بتوصيات عملية قابلة للتطبيق.',
            'جلسة فردية مع مختص لمراجعة تحدٍّ محدد والخروج بتوصيات عملية.']
    );
    await client.query(
        `INSERT INTO center_services (center_id, service_id)
         SELECT 'institutional-guidance', $1 WHERE EXISTS (SELECT 1 FROM enablement_centers WHERE id = 'institutional-guidance')`,
        [created.id]
    );
    console.log(`[seed:rbac] Created service «${SPECIALIST_SERVICE}» #${created.id}`);
};

const upsertRole = async (client, role) => {
    const { rows: [{ id }] } = await client.query(
        `INSERT INTO roles (name, label, description, scope_type, assigned_only)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description,
             scope_type = EXCLUDED.scope_type, assigned_only = EXCLUDED.assigned_only, updated_at = NOW()
         RETURNING id`,
        [role.name, role.label, role.description, role.scopeType, Boolean(role.assignedOnly)]
    );
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE key = ANY($2::varchar[])`,
        [id, role.permissions]
    );
    await client.query('DELETE FROM role_services WHERE role_id = $1', [id]);
    await client.query('DELETE FROM role_centers WHERE role_id = $1', [id]);
    if (role.services) {
        const { rowCount } = await client.query(
            'INSERT INTO role_services (role_id, service_id) SELECT $1, id FROM services WHERE title = ANY($2::varchar[])',
            [id, role.services]
        );
        if (!rowCount) throw new Error(`No services found for ${role.name} — run seed:services first.`);
    }
    if (role.centers) {
        const { rowCount } = await client.query(
            'INSERT INTO role_centers (role_id, center_id) SELECT $1, id FROM enablement_centers WHERE id = ANY($2::varchar[])',
            [id, role.centers]
        );
        if (!rowCount) throw new Error(`No centers found for ${role.name} — run seed:centers first.`);
    }
    return id;
};

let client;
try {
    client = await pool.connect();
    await client.query('BEGIN');
    await ensureSpecialistService(client);

    const roleIds = {};
    for (const role of ROLES) {
        roleIds[role.name] = await upsertRole(client, role);
        console.log(`[seed:rbac] Role ${role.label} (${role.name}): ${role.permissions.length} permissions, ${role.scopeType}${role.assignedOnly ? ' + assigned only' : ''}`);
    }

    const hash = await bcrypt.hash(PASSWORD, 12);
    const userIds = {};
    for (const employee of EMPLOYEES) {
        const { rows: [user] } = await client.query(
            `INSERT INTO users (name, email, password, role_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password,
                 role_id = EXCLUDED.role_id, is_active = TRUE, updated_at = NOW()
             RETURNING id`,
            [employee.name, employee.email, hash, roleIds[employee.role]]
        );
        userIds[employee.email] = user.id;
        console.log(`[seed:rbac] Employee ${employee.email} → ${employee.role}`);
    }

    // Demo assignment: one unassigned request inside the specialist's services goes to the specialist.
    const { rows: assigned } = await client.query(
        `UPDATE service_requests SET assigned_to_user_id = $1, assigned_at = NOW()
         WHERE id = (
             SELECT r.id FROM service_requests r
             WHERE r.status <> 'draft' AND r.assigned_to_user_id IS NULL
               AND r.service_id IN (SELECT service_id FROM role_services WHERE role_id = $2)
             ORDER BY r.updated_at DESC LIMIT 1)
         RETURNING ref_code`,
        [userIds['specialist@nemaa.local'], roleIds.SERVICE_SPECIALIST]
    );
    if (assigned.length) console.log(`[seed:rbac] Assigned ${assigned[0].ref_code} to specialist@nemaa.local`);

    await client.query('COMMIT');
    console.log(`[seed:rbac] Done. Password for every seeded employee: ${PASSWORD}`);
} catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('[seed:rbac] Failed:', error.message);
    process.exitCode = 1;
} finally {
    client?.release();
    await pool.end();
}
