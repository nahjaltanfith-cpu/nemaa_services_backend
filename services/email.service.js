// Placeholder for a real email provider (SMTP / Resend / SendGrid ...).
// Replace the body of sendOtpEmail; callers only depend on its signature.
const SUBJECTS = {
    verify_email: 'رمز تأكيد البريد الإلكتروني - منصة نماء',
    reset_password: 'رمز استعادة كلمة المرور - منصة نماء',
};

export const sendOtpEmail = async ({ to, code, purpose, expiresInMinutes }) => {
    const subject = SUBJECTS[purpose];
    // Opt-in rather than "not production": a deployment with NODE_ENV unset must never log codes.
    if (process.env.NODE_ENV !== 'development') {
        console.warn(`[email] No provider configured; "${subject}" was not sent to ${to}.`);
        return;
    }
    // Development only: print the code so the flow can be tested without a mailbox.
    console.log(`[email:dev] ${subject} → ${to}: ${code} (valid ${expiresInMinutes} min)`);
};
