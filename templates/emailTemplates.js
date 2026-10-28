// Transactional email templates: each returns { subject, html, text }.
// One RTL layout with inline styles and tables (what email clients render reliably), plus a
// plain-text version for clients that don't show HTML. Every interpolated value is escaped.

const BRAND = '#00262D';
const PLATFORM = 'منصة كفاءة';

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

// A highlighted block for the team's notes / what the NGO must fix.
const callout = (title, body, items = []) => `
  <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">${escapeHtml(title)}</p>
    ${body ? `<p style="margin:0;font-size:14px;line-height:1.8;color:#78350f;white-space:pre-line;">${escapeHtml(body)}</p>` : ''}
    ${items.length ? `<ul style="margin:${body ? '8px' : '0'} 0 0;padding:0 18px 0 0;font-size:14px;line-height:1.9;color:#78350f;">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
  </div>`;

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

// ── Auth ────────────────────────────────────────────────────────────────────
const OTP_PURPOSES = {
    verify_email: { subject: 'رمز تأكيد البريد الإلكتروني', intro: 'استخدم الرمز التالي لتأكيد بريدك الإلكتروني في منصة كفاءة:' },
    reset_password: { subject: 'رمز استعادة كلمة المرور', intro: 'استخدم الرمز التالي لتعيين كلمة مرور جديدة لحسابك:' },
};

export const otpEmail = ({ code, purpose, expiresInMinutes }) => {
    const { subject, intro } = OTP_PURPOSES[purpose];
    return {
        subject: `${subject} - ${PLATFORM}`,
        html: layout({
            preheader: `${subject}: صالح لمدة ${expiresInMinutes} دقائق`,
            heading: subject,
            body: `${paragraph(intro)}
              <p style="margin:0 0 18px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px;color:${BRAND};font-family:Consolas,monospace;" dir="ltr">${escapeHtml(code)}</p>
              ${paragraph(`الرمز صالح لمدة ${expiresInMinutes} دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة؛ حسابك آمن.`)}`,
        }),
        text: textOf([intro, '', code, '', `الرمز صالح لمدة ${expiresInMinutes} دقائق. إذا لم تطلبه فتجاهل الرسالة.`]),
    };
};

// ── NGO account ─────────────────────────────────────────────────────────────
export const ngoNeedsDocumentsEmail = ({ ngoName, notes, url }) => ({
    subject: `مطلوب استكمال بيانات حساب الجمعية - ${PLATFORM}`,
    html: layout({
        preheader: 'راجع ملاحظات فريق نماء واستكمل بيانات حسابك',
        heading: 'مطلوب استكمال بيانات الحساب',
        body: `${paragraph(`مرحبًا ${ngoName}،`)}
          ${paragraph('راجع فريق نماء طلب تسجيل جمعيتكم، ويحتاج إلى استكمال قبل اعتماد الحساب.')}
          ${callout('ملاحظات الفريق', notes)}
          ${button('استكمال البيانات', url)}`,
    }),
    text: textOf([`مرحبًا ${ngoName}،`, 'راجع فريق نماء طلب تسجيل جمعيتكم ويحتاج إلى استكمال قبل الاعتماد.', '', 'ملاحظات الفريق:', notes, '', url]),
});

export const ngoApprovedEmail = ({ ngoName, url }) => ({
    subject: `تم اعتماد حساب الجمعية - ${PLATFORM}`,
    html: layout({
        preheader: 'حسابكم معتمد ويمكنكم الآن تقديم الطلبات',
        heading: 'تم اعتماد حساب الجمعية',
        body: `${paragraph(`مرحبًا ${ngoName}،`)}
          ${paragraph('يسعدنا إبلاغكم باعتماد حساب جمعيتكم في منصة كفاءة. يمكنكم الآن تقديم طلبات الخدمات ومراكز التمكين ومتابعتها.')}
          ${button('الدخول إلى المنصة', url)}`,
    }),
    text: textOf([`مرحبًا ${ngoName}،`, 'تم اعتماد حساب جمعيتكم في منصة كفاءة، ويمكنكم الآن تقديم الطلبات.', '', url]),
});

// ── Service requests (to the NGO) ───────────────────────────────────────────
export const requestNeedsCompletionEmail = ({ ngoName, refCode, needTitle, targetName, items, note, url }) => ({
    subject: `مطلوب استكمال الطلب ${refCode} - ${PLATFORM}`,
    html: layout({
        preheader: `الطلب ${refCode} يحتاج إلى مستندات أو معلومات إضافية`,
        heading: 'مطلوب استكمال الطلب',
        body: `${paragraph(`مرحبًا ${ngoName}،`)}
          ${paragraph('راجع فريق نماء طلبكم ويحتاج إلى استكمال حتى نتمكن من متابعة العمل عليه.')}
          ${details([['رقم الطلب', refCode], ['عنوان الاحتياج', needTitle], ['الخدمة / المركز', targetName]])}
          ${callout('المطلوب منكم', note, items)}
          ${button('استكمال الطلب', url)}`,
    }),
    text: textOf([`مرحبًا ${ngoName}،`, `الطلب ${refCode} (${needTitle}) يحتاج إلى استكمال.`, '',
        'المطلوب:', ...items.map((item) => `- ${item}`), note, '', url]),
});

export const requestCompletedEmail = ({ ngoName, refCode, needTitle, targetName, url }) => ({
    subject: `تم إنجاز الطلب ${refCode} - ${PLATFORM}`,
    html: layout({
        preheader: `اكتمل العمل على الطلب ${refCode} والنتيجة متاحة على المنصة`,
        heading: 'تم إنجاز طلبكم',
        body: `${paragraph(`مرحبًا ${ngoName}،`)}
          ${paragraph('اكتمل العمل على طلبكم، ويمكنكم الاطلاع على المخرجات وملفات التسليم من صفحة الطلب.')}
          ${details([['رقم الطلب', refCode], ['عنوان الاحتياج', needTitle], ['الخدمة / المركز', targetName]])}
          ${button('عرض الطلب والمخرجات', url)}`,
    }),
    text: textOf([`مرحبًا ${ngoName}،`, `تم إنجاز الطلب ${refCode} (${needTitle}). المخرجات متاحة على صفحة الطلب.`, '', url]),
});

// ── Service requests (to staff) ─────────────────────────────────────────────
export const newRequestStaffEmail = ({ staffName, ngoName, refCode, needTitle, targetName, url }) => ({
    subject: `طلب جديد ${refCode} من ${ngoName}`,
    html: layout({
        preheader: `${ngoName} أرسلت طلبًا جديدًا على ${targetName}`,
        heading: 'طلب جديد بانتظار المراجعة',
        body: `${paragraph(`مرحبًا ${staffName}،`)}
          ${paragraph('وصل طلب جديد ضمن نطاق عملك في لوحة التحكم.')}
          ${details([['الجمعية', ngoName], ['الخدمة / المركز', targetName], ['عنوان الاحتياج', needTitle], ['رقم الطلب', refCode]])}
          ${button('فتح الطلب في لوحة التحكم', url)}`,
    }),
    text: textOf([`مرحبًا ${staffName}،`, `طلب جديد ${refCode} من ${ngoName} على ${targetName}: ${needTitle}`, '', url]),
});

// ── Contact form (to the team inbox) ────────────────────────────────────────
export const contactRequestEmail = ({ typeLabel, fullName, organizationName, email, phone, message, url }) => ({
    subject: `رسالة جديدة من تواصل معنا: ${typeLabel} - ${fullName}`,
    html: layout({
        preheader: `${fullName} أرسل رسالة (${typeLabel}) من صفحة تواصل معنا`,
        heading: 'رسالة جديدة من صفحة تواصل معنا',
        body: `${details([['نوع الاستفسار', typeLabel], ['الاسم', fullName], ['الجمعية / الجهة', organizationName],
            ['البريد الإلكتروني', email], ['الجوال / واتساب', phone]])}
          ${quote(message)}
          ${button('متابعة الرسالة في لوحة التحكم', url)}`,
    }),
    text: textOf([`رسالة جديدة من تواصل معنا (${typeLabel})`, '', `الاسم: ${fullName}`,
        organizationName && `الجمعية / الجهة: ${organizationName}`, `البريد الإلكتروني: ${email}`,
        phone && `الجوال / واتساب: ${phone}`, '', message, '', url]),
});
