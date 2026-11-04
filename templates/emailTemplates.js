// Transactional email templates: each returns { subject, html, text }.
// One RTL layout with inline styles and tables (what email clients render reliably), plus a
// plain-text version for clients that don't show HTML. Every interpolated value is escaped.

const BRAND = '#00262D';
const PLATFORM = 'كفاءة';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

// Only http(s) links go into href; anything else is dropped.
const safeUrl = (url) => (/^https?:\/\//i.test(url || '') ? url : null);

const paragraph = (text) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(text)}</p>`;

// Label / value rows (e.g. request number, service).
const details = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
    ${rows.filter(([, value]) => value).map(([label, value], index) => `
    <tr>
      <td style="padding:10px 14px;font-size:13px;color:#64748b;width:38%;${index ? 'border-top:1px solid #e2e8f0;' : ''}">${escapeHtml(label)}</td>
      <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#0f172a;${index ? 'border-top:1px solid #e2e8f0;' : ''}">${escapeHtml(value)}</td>
    </tr>`).join('')}
  </table>`;

// A neutral block for text someone else wrote (e.g. a contact-form message), line breaks kept.
const quote = (body) => `
  <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;">
    <p style="margin:0;font-size:14px;line-height:1.9;color:#0f172a;white-space:pre-line;">${escapeHtml(body)}</p>
  </div>`;

const button = (label, url) => (safeUrl(url) ? `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
    <tr><td style="border-radius:8px;background:${BRAND};">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>` : '');

const layout = ({ preheader, heading, body }) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f9;font-family:Tahoma,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;" dir="rtl">
        <tr><td style="padding:18px 24px;background:${BRAND};border-radius:8px 8px 0 0;">
          <p style="margin:0;font-size:17px;font-weight:700;color:#ffffff;">${PLATFORM}</p>
        </td></tr>
        <tr><td style="padding:26px 24px 8px;text-align:right;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.5;color:#0f172a;">${escapeHtml(heading)}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 24px 22px;border-top:1px solid #f1f5f9;text-align:right;">
          <p style="margin:0;font-size:12px;line-height:1.7;color:#94a3b8;">رسالة آلية من ${PLATFORM}، يُرجى عدم الرد عليها.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const textOf = (lines) => [...lines.filter(Boolean), '', `— ${PLATFORM} (رسالة آلية)`].join('\n');

// ── Wording ─────────────────────────────────────────────────────────────────
// Subjects, texts and buttons follow «رسائل البريد.docx». Messages to NGOs end with the team signature.

// One requirement per bullet: the team's notes are split on line breaks (a single line stays one bullet).
const toItems = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.replace(/^[\s•\-–*]+/, '').trim()).filter(Boolean);

const bullets = (items) => (items.length ? `
  <ul style="margin:0 0 18px;padding:0 20px 0 0;font-size:15px;line-height:1.9;color:#0f172a;">
    ${items.map((item) => `<li style="margin:0 0 4px;">${escapeHtml(item)}</li>`).join('')}
  </ul>` : '');

const SIGNATURE_LINES = ['فريق كفاءة', 'جمعية نماء لتطوير القطاع غير الربحي'];
const signature = `
  <p style="margin:22px 0 0;font-size:14px;line-height:1.8;color:#334155;">
    ${SIGNATURE_LINES.map(escapeHtml).join('<br>')}
  </p>`;

// Request number / service or track / NGO, as the short table the doc asks for
const requestTable = ({ refCode, targetName, ngoName }) =>
    details([['رقم الطلب', refCode], ['الخدمة أو المسار', targetName], ['الجمعية', ngoName]]);

// The code: large, monospaced and selectable in one tap so it can be copied
const codeBlock = (code) => `
  <p style="margin:0 0 18px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND};font-family:Consolas,monospace;-webkit-user-select:all;user-select:all;" dir="ltr">${escapeHtml(code)}</p>`;

// ── Auth (to the NGO) ───────────────────────────────────────────────────────
const OTP_PURPOSES = {
    verify_email: {
        subject: 'رمز تأكيد بريدك الإلكتروني في كفاءة',
        before: ['مرحبًا،', 'لإكمال التسجيل في كفاءة، أدخل رمز التأكيد التالي:'],
        ignore: 'إذا لم تطلب التسجيل، يمكنك تجاهل هذه الرسالة. لا تشارك الرمز مع أي شخص.',
    },
    reset_password: {
        subject: 'رمز إعادة تعيين كلمة المرور في كفاءة',
        before: ['تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك في كفاءة.', 'أدخل الرمز التالي لإتمام الطلب:'],
        ignore: 'إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة؛ ستبقى كلمة مرورك دون تغيير. لا تشارك الرمز مع أي شخص.',
    },
};

export const otpEmail = ({ code, purpose, expiresInMinutes }) => {
    const { subject, before, ignore } = OTP_PURPOSES[purpose];
    const expiry = `تنتهي صلاحية الرمز خلال ${expiresInMinutes} دقائق.`;
    return {
        subject,
        html: layout({
            preheader: `${subject}: ${expiry}`,
            heading: subject,
            body: `${before.map(paragraph).join('')}
              ${codeBlock(code)}
              ${paragraph(expiry)}
              ${paragraph(ignore)}
              ${signature}`,
        }),
        text: textOf([...before, '', code, '', expiry, ignore, '', ...SIGNATURE_LINES]),
    };
};

// ── NGO account (to the NGO) ────────────────────────────────────────────────
export const ngoNeedsDocumentsEmail = ({ ngoName, notes, url }) => {
    const items = toItems(notes);
    return {
        subject: `يلزم استكمال بيانات حساب ${ngoName} في كفاءة`,
        html: layout({
            preheader: 'نأمل استكمال متطلبات حساب الجمعية لمتابعة مراجعته',
            heading: 'استكمال بيانات حساب الجمعية',
            body: `${paragraph(`مرحبًا بفريق ${ngoName}،`)}
              ${paragraph('بعد مراجعة بيانات حساب الجمعية، نأمل استكمال المتطلبات التالية لمتابعة مراجعة الحساب:')}
              ${bullets(items)}
              ${paragraph('يمكنكم تحديث البيانات من خلال الزر أدناه.')}
              ${button('استكمال بيانات الجمعية', url)}
              ${signature}`,
        }),
        text: textOf([`مرحبًا بفريق ${ngoName}،`, 'بعد مراجعة بيانات حساب الجمعية، نأمل استكمال المتطلبات التالية لمتابعة مراجعة الحساب:',
            ...items.map((item) => `- ${item}`), '', 'يمكنكم تحديث البيانات من خلال الرابط:', url, '', ...SIGNATURE_LINES]),
    };
};

export const ngoApprovedEmail = ({ ngoName, url }) => ({
    subject: `تم اعتماد حساب ${ngoName} في كفاءة`,
    html: layout({
        preheader: 'حساب جمعيتكم معتمد ويمكنكم الآن تقديم طلبات الاستفادة',
        heading: 'تم اعتماد حساب الجمعية',
        body: `${paragraph(`مرحبًا بفريق ${ngoName}،`)}
          ${paragraph('يسعدنا إشعاركم باعتماد حساب جمعيتكم في كفاءة.')}
          ${paragraph('يمكنكم الآن استعراض الخدمات المتاحة وتقديم طلبات الاستفادة ومتابعتها من حساب الجمعية.')}
          ${button('الدخول إلى حساب الجمعية', url)}
          ${signature}`,
    }),
    text: textOf([`مرحبًا بفريق ${ngoName}،`, 'يسعدنا إشعاركم باعتماد حساب جمعيتكم في كفاءة.',
        'يمكنكم الآن استعراض الخدمات المتاحة وتقديم طلبات الاستفادة ومتابعتها من حساب الجمعية.', '', url, '', ...SIGNATURE_LINES]),
});

// ── Service requests (to the NGO) ───────────────────────────────────────────
// inExecution: the work had already started ("متابعة تنفيذه"), else it is still in review.
export const requestNeedsCompletionEmail = ({ ngoName, refCode, targetName, items, note, inExecution, url }) => {
    const requirements = [...items, ...toItems(note)];
    const purpose = inExecution ? 'متابعة تنفيذه' : 'متابعة مراجعة الطلب';
    const intro = `يحتاج طلبكم إلى استكمال المتطلبات التالية حتى نتمكن من ${purpose}:`;
    return {
        subject: `يلزم استكمال طلبكم رقم ${refCode} في كفاءة`,
        html: layout({
            preheader: `طلبكم رقم ${refCode} يحتاج إلى استكمال`,
            heading: 'استكمال طلب الخدمة',
            body: `${paragraph(`مرحبًا بفريق ${ngoName}،`)}
              ${paragraph(intro)}
              ${bullets(requirements)}
              ${requestTable({ refCode, targetName, ngoName })}
              ${paragraph('يرجى استكمال المطلوب من خلال الزر أدناه.')}
              ${button('استكمال الطلب', url)}
              ${signature}`,
        }),
        text: textOf([`مرحبًا بفريق ${ngoName}،`, intro, ...requirements.map((item) => `- ${item}`), '',
            `رقم الطلب: ${refCode}`, `الخدمة أو المسار: ${targetName}`, '', 'يرجى استكمال المطلوب من خلال الرابط:', url, '', ...SIGNATURE_LINES]),
    };
};

export const requestCompletedEmail = ({ ngoName, refCode, targetName, url }) => ({
    subject: `تم إنجاز طلبكم رقم ${refCode} في كفاءة`,
    html: layout({
        preheader: `المخرجات وملفات التسليم للطلب ${refCode} متاحة في حساب الجمعية`,
        heading: 'تم إنجاز طلبكم',
        body: `${paragraph(`مرحبًا بفريق ${ngoName}،`)}
          ${paragraph(`تم إنجاز طلبكم لخدمة ${targetName}، وأصبحت المخرجات وملفات التسليم متاحة في حساب الجمعية.`)}
          ${requestTable({ refCode, targetName, ngoName })}
          ${paragraph('يمكنكم الاطلاع عليها وتنزيلها من خلال الزر أدناه.')}
          ${button('عرض الطلب والمخرجات', url)}
          ${paragraph('نسعد بخدمتكم.')}
          ${signature}`,
    }),
    text: textOf([`مرحبًا بفريق ${ngoName}،`, `تم إنجاز طلبكم لخدمة ${targetName}، وأصبحت المخرجات وملفات التسليم متاحة في حساب الجمعية.`,
        `رقم الطلب: ${refCode}`, '', 'يمكنكم الاطلاع عليها وتنزيلها من خلال الرابط:', url, '', 'نسعد بخدمتكم.', '', ...SIGNATURE_LINES]),
});

// ── Service requests (to staff) ─────────────────────────────────────────────
export const newRequestStaffEmail = ({ ngoName, refCode, targetName, url }) => ({
    subject: `طلب جديد رقم ${refCode} من ${ngoName}`,
    html: layout({
        preheader: `${ngoName} أرسلت طلبًا جديدًا للاستفادة من ${targetName}`,
        heading: 'طلب جديد',
        body: `${paragraph(`ورد طلب جديد من ${ngoName} للاستفادة من ${targetName}.`)}
          ${requestTable({ refCode, targetName, ngoName })}
          ${paragraph('يرجى مراجعة بيانات الطلب ومرفقاته وتحديد الإجراء المناسب.')}
          ${button('مراجعة الطلب', url)}`,
    }),
    text: textOf([`ورد طلب جديد من ${ngoName} للاستفادة من ${targetName}.`, `رقم الطلب: ${refCode}`, '',
        'يرجى مراجعة بيانات الطلب ومرفقاته وتحديد الإجراء المناسب.', url]),
});

// ── Contact form (to the team inbox) ────────────────────────────────────────
export const contactRequestEmail = ({ typeLabel, fullName, organizationName, email, phone, message, url }) => ({
    subject: `رسالة تواصل جديدة بشأن ${typeLabel} من ${fullName}`,
    html: layout({
        preheader: `${fullName} أرسل رسالة (${typeLabel}) عبر نموذج تواصل معنا`,
        heading: 'رسالة تواصل جديدة',
        body: `${paragraph('وردت رسالة جديدة عبر نموذج “تواصل معنا” في كفاءة.')}
          ${details([['اسم المرسل', fullName], ['البريد الإلكتروني', email], ['نوع الرسالة', typeLabel],
            ['الجمعية / الجهة', organizationName], ['الجوال / واتساب', phone]])}
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#64748b;">نص الرسالة</p>
          ${quote(message)}
          ${paragraph('يرجى الاطلاع عليها ومتابعتها.')}
          ${button('عرض الرسالة ومتابعتها', url)}`,
    }),
    text: textOf(['وردت رسالة جديدة عبر نموذج “تواصل معنا” في كفاءة.', '', `اسم المرسل: ${fullName}`, `البريد الإلكتروني: ${email}`,
        `نوع الرسالة: ${typeLabel}`, organizationName && `الجمعية / الجهة: ${organizationName}`, phone && `الجوال / واتساب: ${phone}`,
        '', 'نص الرسالة:', message, '', 'يرجى الاطلاع عليها ومتابعتها.', url]),
});
