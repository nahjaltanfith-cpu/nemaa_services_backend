// Demo requests for one approved NGO ("ركاز الطاقة" by default), one per status, with real PDF
// files, status history, missing-document rounds, deliverables and messages.
//
//   npm run seed:requests                 seed for the NGO named "ركاز الطاقة"
//   npm run seed:requests -- --ngo=13     seed for another NGO id
//
// Re-running replaces the demo requests (matched by their fixed ref codes); real requests are untouched.
import crypto from 'node:crypto';
import pool from '../db.js';
import { storeFile } from '../services/upload.service.js';

const ngoArg = process.argv.find((arg) => arg.startsWith('--ngo='));
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo, hour = 10) => {
    const date = new Date(Date.now() - daysAgo * DAY);
    date.setHours(hour, 15, 0, 0);
    return date;
};

// A small but valid one-page PDF (built-in font, so the text inside is Latin).
const makePdf = (lines) => {
    const text = lines.map((line, index) => `BT /F1 ${index ? 12 : 18} Tf 60 ${760 - index * 28} Td (${line.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
        const offset = Buffer.byteLength(body);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = Buffer.byteLength(body);
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body);
};

// { name: shown file name, en: English line printed inside the PDF }
const storePdf = async ({ name, en }, ngoName) => {
    const buffer = makePdf([en, `Organization: ${ngoName === 'ركاز الطاقة' ? 'Rekaz Energy' : 'NGO'}`, 'Nemaa platform - demo document', `Issued: ${new Date().getFullYear()}`]);
    const { key } = await storeFile(`temp/${crypto.randomUUID()}.pdf`, buffer);
    return { key, name, size: buffer.length };
};

// ── The demo requests ───────────────────────────────────────────────────────
// files: label = required document name (from the service), null = extra file.
// history: status-log entries in order; deliverables / missing / messages as in a real request.
const REQUESTS = [
    {
        ref: 'REQ-1E22A044', status: 'completed', target: { service: 3 },
        needTitle: 'إعداد دليل الحوكمة ولائحة تعارض المصالح',
        summary: 'نحتاج دليل حوكمة متكامل متوافق مع متطلبات المركز الوطني لتنمية القطاع غير الربحي',
        description: 'ظهرت في آخر تقييم للحوكمة ملاحظات على غياب سياسة تعارض المصالح وعدم وضوح صلاحيات مجلس الإدارة.\nنرغب في إعداد دليل حوكمة شامل، ولائحة لتعارض المصالح، ومصفوفة صلاحيات معتمدة من الجمعية العمومية.',
        contact: 'meeting', created: 40,
        files: [
            { label: 'محاضر الجمعية العمومية الأخيرة', name: 'محضر_الجمعية_العمومية_2026.pdf', en: 'General Assembly minutes 2026' },
            { label: 'اللوائح الداخلية المرتبطة بموضوع السياسة (إن وجدت)', name: 'اللائحة_الأساسية.pdf', en: 'Bylaws' },
            { label: null, name: 'تقرير_تقييم_الحوكمة.pdf', en: 'Governance assessment report' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 40 },
            { status: 'under_study', label: 'قيد الدراسة والمراجعة', actor: 'admin', days: 38 },
            { status: 'in_progress', label: 'تم التوجيه لمستشار الحوكمة', note: 'تم تحديد ورشة عمل مع مجلس الإدارة يوم الأحد القادم.', actor: 'admin', days: 35 },
            { status: 'in_progress', label: 'تم تسليم المسودة الأولى للمراجعة', note: 'أُرسلت المسودة لمجلس الإدارة لإبداء الملاحظات.', actor: 'admin', days: 24 },
            { status: 'in_progress', label: 'تم رفع ملفات التسليم', note: 'دليل الحوكمة المعتمد، لائحة تعارض المصالح', actor: 'admin', days: 16, deliver: true },
            { status: 'completed', label: 'تم اعتماد الدليل وإنهاء الطلب بنجاح', actor: 'admin', days: 15 },
        ],
        deliverables: [
            { label: 'دليل الحوكمة', name: 'دليل_الحوكمة_المعتمد.pdf', en: 'Governance manual - final' },
            { label: 'لائحة تعارض المصالح', name: 'لائحة_تعارض_المصالح.pdf', en: 'Conflict of interest policy - final' },
        ],
        messages: [
            { from: 'ngo', body: 'هل يمكن أن تشمل اللائحة نموذج إفصاح سنوي لأعضاء المجلس؟', days: 30 },
            { from: 'admin', body: 'أكيد، أضفنا نموذج الإفصاح السنوي كملحق في اللائحة.', days: 29 },
            { from: 'ngo', body: 'شكرًا لكم، تم اعتماد الدليل في اجتماع المجلس.', days: 15 },
        ],
    },
    {
        ref: 'REQ-9A4B12C0', status: 'in_progress', target: { service: 2 },
        needTitle: 'تطوير النظام المحاسبي وبناء الموازنة التقديرية 2027',
        summary: 'نظام محاسبي واضح وموازنة تقديرية مبنية على بيانات فعلية للسنة القادمة',
        description: 'تعتمد الجمعية حاليًا على جداول إكسل لتسجيل القيود، ونواجه تأخرًا في إعداد التقارير الشهرية.\nنحتاج تصميم دليل حسابات، ودورة مستندية، وموازنة تقديرية لعام 2027 مع تدريب المحاسب على التطبيق.',
        contact: 'session', created: 18,
        files: [
            { label: 'القوائم المالية لآخر سنة مالية', name: 'القوائم_المالية_المدققة_2025.pdf', en: 'Audited financial statements 2025' },
            { label: 'اللائحة المالية الحالية (إن وجدت)', name: 'اللائحة_المالية.pdf', en: 'Financial regulations' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 18 },
            { status: 'needs_completion', label: 'مطلوب استكمال مستندات', note: 'نحتاج خطاب التفويض بالتوقيع وكشف الحساب البنكي للبدء في مراجعة القيود.', actor: 'admin', days: 16, missing: true },
            { status: 'under_study', label: 'تم إرسال المستندات المطلوبة', actor: 'ngo', days: 14, fulfil: true },
            { status: 'in_progress', label: 'تم التوجيه للمستشار المالي', note: 'المستشار المالي سيتواصل معكم لتحديد موعد الجلسة الأولى.', actor: 'admin', days: 12 },
            { status: 'in_progress', label: 'جاري تصميم دليل الحسابات', actor: 'admin', days: 5 },
        ],
        missing: [
            { name: 'خطاب التفويض بالتوقيع', file: { name: 'خطاب_التفويض.pdf', en: 'Signing authorization letter' } },
            { name: 'كشف الحساب البنكي لآخر 3 أشهر', file: { name: 'كشف_حساب_بنكي.pdf', en: 'Bank statement - last 3 months' } },
        ],
        messages: [
            { from: 'admin', body: 'مرحبًا، هل يوجد نظام محاسبي مستخدم حاليًا غير الإكسل؟', days: 15 },
            { from: 'ngo', body: 'لا، كل القيود حاليًا على إكسل، ونفضّل نظامًا سحابيًا بسيطًا.', days: 15 },
            { from: 'admin', body: 'تمام، سنقترح عليكم خيارين في الجلسة الأولى.', days: 12 },
        ],
    },
    {
        ref: 'REQ-3F51D099', status: 'needs_completion', target: { service: 5 },
        needTitle: 'برنامج تأهيل الكوادر التنفيذية في إدارة المشاريع',
        summary: 'رفع كفاءة 8 موظفين تنفيذيين في التخطيط ومتابعة المشاريع التنموية',
        description: 'توسعت مشاريع الجمعية خلال العام الحالي، وأصبح فريق التنفيذ يحتاج إلى مهارات أعلى في التخطيط وإدارة المخاطر وكتابة التقارير للجهات المانحة.',
        contact: 'call', created: 9,
        files: [
            { label: 'قائمة المرشحين للتدريب وأدوارهم', name: 'قائمة_المرشحين.pdf', en: 'Training candidates list' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 9 },
            { status: 'under_study', label: 'تمت دراسة الاحتياج التدريبي', actor: 'admin', days: 7 },
            { status: 'needs_completion', label: 'مطلوب استكمال مستندات', note: 'لتصميم الحقيبة التدريبية بدقة نحتاج الهيكل التنظيمي المعتمد ووصف الأدوار الحالي للمرشحين.', actor: 'admin', days: 3, missing: true },
        ],
        missing: [
            { name: 'الهيكل التنظيمي المعتمد' },
            { name: 'الوصف الوظيفي للمرشحين' },
        ],
        messages: [
            { from: 'admin', body: 'أضفنا مستندين مطلوبين في صفحة الطلب، ارفعوهم عشان نكمل تصميم البرنامج.', days: 3 },
        ],
    },
    {
        ref: 'REQ-7C88E142', status: 'under_study', target: { center: 'financial-operations' },
        needTitle: 'تأهيل الجمعية للحصول على منح الأوقاف وتنمية الموارد',
        summary: 'تدريب الفريق المالي وصياغة مقترحات مشاريع استثمارية نوعية',
        description: 'نطمح إلى رفع الملاءة المالية وتنويع مصادر الدخل غير المشروط من خلال خطة استثمارية متكاملة، والتقدم لمنح الأوقاف المتاحة هذا العام.',
        contact: 'session', created: 4,
        files: [
            { label: null, name: 'التقرير_المالي_الربعي.pdf', en: 'Quarterly financial report' },
            { label: null, name: 'خطة_تنمية_الموارد.pdf', en: 'Resource development plan - draft' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 4 },
            { status: 'under_study', label: 'جاري دراسة الاحتياج والملفات', actor: 'admin', days: 3 },
        ],
        messages: [],
    },
    {
        ref: 'REQ-B61A0E37', status: 'under_study', target: { center: 'institutional-guidance' },
        needTitle: 'إرشاد قيادي للمدير التنفيذي الجديد',
        summary: 'جلسات إرشاد خلال أول 90 يومًا للمدير التنفيذي',
        description: 'تم تعيين مدير تنفيذي جديد الشهر الماضي، ونرغب في دعمه بجلسات إرشاد قيادي لبناء خطة أول 90 يومًا وترتيب أولويات الإدارة.',
        contact: 'meeting', created: 1,
        files: [
            { label: null, name: 'الخطة_التشغيلية_2026.pdf', en: 'Operational plan 2026' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 1 },
        ],
        messages: [
            { from: 'ngo', body: 'نفضّل أن تكون الجلسات مساءً بعد الساعة الخامسة إن أمكن.', days: 1 },
        ],
    },
    {
        ref: 'REQ-D4C2915B', status: 'completed', target: { center: 'institutional-communication' },
        needTitle: 'بناء الهوية المؤسسية ودليل الرسائل الإعلامية',
        summary: 'هوية موحدة ورسائل واضحة قبل إطلاق حملة التبرعات السنوية',
        description: 'نستعد لإطلاق حملة التبرعات السنوية، ونحتاج هوية بصرية محدثة ودليل رسائل موحد لكل القنوات.',
        contact: 'meeting', created: 60,
        files: [
            { label: null, name: 'الشعار_الحالي.pdf', en: 'Current logo' },
        ],
        history: [
            { status: 'under_study', label: 'تم تقديم الطلب', actor: 'ngo', days: 60 },
            { status: 'in_progress', label: 'تم التوجيه لفريق الاتصال المؤسسي', actor: 'admin', days: 57 },
            { status: 'in_progress', label: 'تم رفع ملفات التسليم', note: 'دليل الهوية، دليل الرسائل', actor: 'admin', days: 41, deliver: true },
            { status: 'completed', label: 'تم تسليم الهوية وإنهاء الطلب', actor: 'admin', days: 40 },
        ],
        deliverables: [
            { label: 'دليل الهوية البصرية', name: 'دليل_الهوية_البصرية.pdf', en: 'Brand identity guidelines' },
            { label: 'دليل الرسائل', name: 'دليل_الرسائل_الإعلامية.pdf', en: 'Messaging guide' },
        ],
        messages: [
            { from: 'admin', body: 'تم رفع دليل الهوية النهائي، بالتوفيق في الحملة.', days: 40 },
        ],
    },
    {
        ref: 'DRAFT-6B789C10', status: 'draft', target: { center: 'training-center' },
        needTitle: 'برنامج تدريبي مكثف لأعضاء مجلس الإدارة والمدير التنفيذي',
        summary: 'مسودة قيد الإعداد لتحديد عدد المتدربين والجدول الزمني المناسب',
        description: 'نستهدف تعزيز مهارات القيادة التكيفية والحوكمة المؤسسية المتقدمة.',
        contact: 'call', created: 0.2,
        files: [],
        history: [{ status: 'draft', label: 'تم حفظ المسودة', actor: 'ngo', days: 0.2 }],
        messages: [],
    },
];

const client = await pool.connect();
try {
    const { rows: ngos } = ngoArg
        ? await client.query('SELECT id, ngo_name FROM ngos WHERE id = $1', [Number(ngoArg.split('=')[1])])
        : await client.query("SELECT id, ngo_name FROM ngos WHERE ngo_name = 'ركاز الطاقة'");
    if (!ngos.length) throw new Error('NGO not found (pass --ngo=<id>)');
    const ngo = ngos[0];
    const { rows: [adminUser] } = await client.query('SELECT id FROM users ORDER BY id LIMIT 1');
    const adminId = adminUser?.id ?? null;

    await client.query('BEGIN');
    await client.query('DELETE FROM service_requests WHERE ref_code = ANY($1::varchar[])', [REQUESTS.map((r) => r.ref)]);

    for (const r of REQUESTS) {
        const target = r.target.service
            ? (await client.query("SELECT 'service' AS type, id AS service_id, NULL AS center_id, title FROM services WHERE id = $1", [r.target.service])).rows[0]
            : (await client.query("SELECT 'center' AS type, NULL::int AS service_id, id AS center_id, title FROM enablement_centers WHERE id = $1", [r.target.center])).rows[0];
        if (!target) throw new Error(`Target missing for ${r.ref}`);
        const lastDays = Math.min(...r.history.map((h) => h.days));
        const { rows: [{ id }] } = await client.query(
            `INSERT INTO service_requests (ref_code, ngo_id, target_type, service_id, center_id, target_name, need_title,
                 summary, description, contact_method, status, completion_note, submitted_at, created_at, updated_at,
                 ngo_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
            [r.ref, ngo.id, target.type, target.service_id, target.center_id, target.title, r.needTitle, r.summary,
                r.description, r.contact, r.status,
                r.status === 'needs_completion' ? r.history.at(-1).note : null,
                r.status === 'draft' ? null : at(r.created), at(r.created, 9), at(lastDays, 16),
                // Waiting on the NGO (new documents asked / work started) = not opened since.
                ['needs_completion', 'in_progress'].includes(r.status) ? at(r.created, 12) : new Date()]
        );

        const { rows: [service] } = target.service_id
            ? await client.query('SELECT required_attachments FROM services WHERE id = $1', [target.service_id])
            : { rows: [{ required_attachments: [] }] };
        for (const file of r.files) {
            const stored = await storePdf(file, ngo.ngo_name);
            const doc = service.required_attachments.find((item) => item.name === file.label);
            await client.query(
                `INSERT INTO request_files (request_id, kind, label, required, file_key, original_name, size, created_at)
                 VALUES ($1, 'ngo', $2, $3, $4, $5, $6, $7)`,
                [id, file.label, Boolean(doc?.required), stored.key, stored.name, stored.size, at(r.created, 9)]
            );
        }

        for (const entry of r.history) {
            const when = at(entry.days, entry.actor === 'ngo' ? 11 : 14);
            if (entry.missing) {
                for (const item of r.missing) {
                    const { rows: [row] } = await client.query(
                        'INSERT INTO request_missing_items (request_id, name, created_at) VALUES ($1, $2, $3) RETURNING id',
                        [id, item.name, when]
                    );
                    item.id = row.id;
                }
            }
            if (entry.fulfil) {
                for (const item of r.missing) {
                    const stored = await storePdf(item.file, ngo.ngo_name);
                    await client.query(
                        `INSERT INTO request_files (request_id, kind, label, missing_item_id, file_key, original_name, size, created_at)
                         VALUES ($1, 'completion', $2, $3, $4, $5, $6, $7)`,
                        [id, item.name, item.id, stored.key, stored.name, stored.size, when]
                    );
                    await client.query('UPDATE request_missing_items SET fulfilled_at = $2 WHERE id = $1', [item.id, when]);
                }
            }
            if (entry.deliver) {
                for (const file of r.deliverables) {
                    const stored = await storePdf(file, ngo.ngo_name);
                    await client.query(
                        `INSERT INTO request_files (request_id, kind, label, file_key, original_name, size, uploaded_by_user_id, created_at)
                         VALUES ($1, 'deliverable', $2, $3, $4, $5, $6, $7)`,
                        [id, file.label, stored.key, stored.name, stored.size, adminId, when]
                    );
                }
            }
            await client.query(
                `INSERT INTO request_status_log (request_id, status, label, note, actor_type, actor_user_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [id, entry.status, entry.label, entry.note || null, entry.actor, entry.actor === 'admin' ? adminId : null, when]
            );
        }

        // Old messages are read; the newest admin message stays unread so the badge shows.
        const lastAdmin = r.messages.findLastIndex((m) => m.from === 'admin');
        for (const [index, message] of r.messages.entries()) {
            const when = at(message.days, message.from === 'ngo' ? 12 : 15);
            const unread = message.from === 'admin' && index === lastAdmin && r.status !== 'completed';
            await client.query(
                `INSERT INTO request_messages (request_id, sender_type, sender_user_id, body, created_at, read_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [id, message.from, message.from === 'admin' ? adminId : null, message.body, when, unread ? null : new Date(when.getTime() + 3600000)]
            );
        }
        console.log(`[seed:requests] ${r.ref.padEnd(15)} ${r.status.padEnd(17)} ${r.needTitle}`);
    }

    await client.query('COMMIT');
    console.log(`[seed:requests] ${REQUESTS.length} demo requests for «${ngo.ngo_name}» (id ${ngo.id})`);
} catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[seed:requests] Failed:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
