import nodemailer from 'nodemailer';
import { otpEmail } from '../templates/emailTemplates.js';

/**
 * Transactional email over SMTP (any provider: Resend, SendGrid, Mailgun, Office 365 … all expose
 * SMTP). Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SENDER_EMAIL in .env.
 * Without them every email is printed as "[Mock Email Log]" instead, so local flows keep working.
 *
 * Only critical milestones send email (see services/notifications.service.js); routine updates and
 * chat stay in-app.
 */
const RETRY_DELAY_MS = 5000;

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const sender = () => process.env.SENDER_EMAIL || 'Nemaa Platform <info@namaa.sa>';

let transporter = null;
const getTransporter = () => {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT) || 587;
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            // 465 = implicit TLS; 587 / 2525 upgrade with STARTTLS.
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            pool: true,
            maxConnections: 3,
        });
    }
    return transporter;
};

/**
 * Sends one email. Never throws: resolves to { sent, mocked?, error? } and logs the outcome.
 * @param {{ to: string | string[], subject: string, html: string, text?: string }} message
 */
export const sendEmail = async ({ to, subject, html, text }) => {
    const recipients = [].concat(to).filter(Boolean);
    if (!recipients.length) return { sent: false, error: 'no recipient' };
    if (!smtpConfigured()) {
        console.log(`[Mock Email Log] to: ${recipients.join(', ')} | subject: ${subject}`);
        // The body may hold an OTP: print it only when explicitly in development.
        if (process.env.NODE_ENV === 'development' && text) console.log(`[Mock Email Log] body:\n${text}`);
        return { sent: false, mocked: true };
    }
    try {
        const info = await getTransporter().sendMail({ from: sender(), to: recipients.join(', '), subject, html, text });
        console.log(`[email] sent "${subject}" → ${recipients.join(', ')} (${info.messageId})`);
        return { sent: true };
    } catch (error) {
        console.error(`[email] failed "${subject}" → ${recipients.join(', ')}: ${error.message}`);
        return { sent: false, error: error.message };
    }
};

/**
 * Fire-and-forget: sends after the current request finishes, retries once on failure, and never
 * reaches the caller — an email problem can't fail an API call or roll back its transaction.
 */
export const queueEmail = (message) => {
    setImmediate(async () => {
        let result = await sendEmail(message);
        if (result.error && !result.mocked && smtpConfigured()) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            result = await sendEmail(message);
            if (result.error) console.error(`[email] giving up on "${message.subject}" after a retry`);
        }
    });
};

// NGO sign-up verification and password reset (called by services/ngoAuth.service.js).
export const sendOtpEmail = async ({ to, code, purpose, expiresInMinutes }) => {
    queueEmail({ to, ...otpEmail({ code, purpose, expiresInMinutes }) });
};
