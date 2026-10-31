import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { NGO_ROLE } from '../middlewares/auth.middleware.js';
import { HttpError } from '../utils/httpError.js';
import { sendOtpEmail } from './email.service.js';
import { fileExists } from './upload.service.js';
import { DOCUMENTS, NGO_COLUMNS, hasAllDocuments, toPublicNgo } from './ngo.mapper.js';
import { EVENTS, emitToAdmins, emitToThread } from './realtime.service.js';
import {
    OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_MINUTES,
    generateOtp, hashOtp, otpMatches,
} from './otp.service.js';

const BCRYPT_ROUNDS = 12;
export { NGO_ROLE };

// Compared against when the email is unknown, so response time does not reveal registered emails.
let dummyHash;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS));

// Maps unique-constraint violations on ngos to 409s; returns any other error unchanged.
const uniqueViolation = (error) => {
    if (error.code !== '23505') return error;
    return error.constraint === 'ngos_reg_number_key'
        ? new HttpError(409, 'رقم التسجيل مسجّل مسبقًا لجمعية أخرى', 'REG_NUMBER_TAKEN')
        : new HttpError(409, 'البريد الإلكتروني مسجّل مسبقًا', 'EMAIL_TAKEN');
};

const invalidOtp = () => new HttpError(400, 'رمز التحقق غير صحيح أو انتهت صلاحيته', 'INVALID_OTP');

// Keeps only keys that point to a stored upload, so a failed or forged upload
// simply leaves that document missing instead of rejecting the registration.
const resolveDocumentKeys = async (documents = {}) => Object.fromEntries(
    await Promise.all(DOCUMENTS.map(async ({ key, column }) => {
        const value = documents[key];
        return [column, value && await fileExists(value) ? value : null];
    }))
);

const signNgoToken = (ngo) => jwt.sign(
    { id: ngo.id, role: NGO_ROLE },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const session = (row) => {
    const user = toPublicNgo(row);
    return { token: signNgoToken(user), user };
};

const deliverOtp = (email, code, purpose) =>
    sendOtpEmail({ to: email, code, purpose, expiresInMinutes: OTP_TTL_MINUTES });

/**
 * Stores a fresh OTP for the NGO and emails it. Silently does nothing when the email
 * is unknown, a code for the same purpose was sent within the cooldown, or (for verify_email) the email is
 * already verified, so callers can always answer with the same generic response.
 */
const issueOtp = async (email, purpose) => {
    const code = generateOtp();
    const { rows } = await pool.query(
        `UPDATE ngos
         SET otp_code = $2, otp_purpose = $3, otp_attempts = 0,
             otp_expires_at = NOW() + make_interval(mins => $4),
             otp_sent_at = NOW(), updated_at = NOW()
         WHERE email = $1
           AND (otp_purpose IS DISTINCT FROM $3
                OR otp_sent_at < NOW() - make_interval(secs => $5))
           AND ($3 <> 'verify_email' OR email_verified_at IS NULL)
         RETURNING id`,
        [email, hashOtp(code), purpose, OTP_TTL_MINUTES, OTP_RESEND_COOLDOWN_SECONDS]
    );
    if (rows.length) await deliverOtp(email, code, purpose);
};

/**
 * Counts one attempt against the active OTP and checks it. The attempt is committed
 * before the comparison, so wrong guesses always use up the attempt budget.
 */
const checkOtp = async (email, code, purpose) => {
    const { rows } = await pool.query(
        `UPDATE ngos SET otp_attempts = otp_attempts + 1
         WHERE email = $1 AND otp_purpose = $2
           AND otp_expires_at > NOW() AND otp_attempts < $3
         RETURNING otp_code`,
        [email, purpose, OTP_MAX_ATTEMPTS]
    );
    if (!rows.length || !otpMatches(code, rows[0].otp_code)) throw invalidOtp();
    return rows[0].otp_code;
};

export const registerNgo = async ({ ngo, representative, documents }) => {
    const code = generateOtp();
    const passwordHash = await bcrypt.hash(representative.password, BCRYPT_ROUNDS);
    const keys = await resolveDocumentKeys(documents);
    const missingDocuments = DOCUMENTS.filter(({ column }) => !keys[column]).map(({ key }) => key);
    // Complete registrations wait for an admin ('new'); missing files are requested later.
    const accountStatus = missingDocuments.length ? 'needs_documents' : 'new';
    let ngoId;
    try {
        const { rows } = await pool.query(
            `INSERT INTO ngos (ngo_name, reg_number, field_of_work, representative_name,
                 position, email, mobile, password, account_status,
                 ngo_document_key, representative_proof_key,
                 otp_code, otp_purpose, otp_expires_at, otp_attempts, otp_sent_at, region_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, 'verify_email', NOW() + make_interval(mins => $13), 0, NOW(), $14)
             RETURNING id`,
            [ngo.ngoName, ngo.regNumber, ngo.fieldOfWork, representative.representativeName,
                representative.position || null, representative.email, representative.mobile,
                passwordHash, accountStatus, keys.ngo_document_key, keys.representative_proof_key,
                hashOtp(code), OTP_TTL_MINUTES, ngo.regionId]
        );
        ngoId = rows[0].id;
    } catch (error) {
        // region_id points to a region that doesn't exist
        if (error.code === '23503') throw new HttpError(400, 'المنطقة المختارة غير صالحة', 'REGION_NOT_FOUND');
        throw uniqueViolation(error);
    }
    await deliverOtp(representative.email, code, 'verify_email');
    emitToAdmins(EVENTS.NGO_UPDATED, { ngoId });
    return { email: representative.email, accountStatus, missingDocuments };
};

export const verifyEmail = async ({ email, otp_code: code }) => {
    const otpHash = await checkOtp(email, code, 'verify_email');
    // Matching on the hash makes the OTP single-use even under concurrent requests.
    const { rows } = await pool.query(
        `UPDATE ngos
         SET email_verified_at = NOW(), otp_code = NULL, otp_purpose = NULL,
             otp_expires_at = NULL, otp_attempts = 0, updated_at = NOW()
         WHERE email = $1 AND otp_purpose = 'verify_email' AND otp_code = $2
         RETURNING ${NGO_COLUMNS}`,
        [email, otpHash]
    );
    if (!rows.length) throw invalidOtp();
    return session(rows[0]);
};

export const resendVerification = ({ email }) => issueOtp(email, 'verify_email');

export const loginNgo = async ({ email, password }) => {
    const { rows } = await pool.query(
        `SELECT ${NGO_COLUMNS}, password, email_verified_at FROM ngos WHERE email = $1`,
        [email]
    );
    const row = rows[0];
    const valid = await bcrypt.compare(password, row?.password ?? getDummyHash());
    if (!row || !valid) {
        throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'INVALID_CREDENTIALS');
    }
    if (!row.email_verified_at) {
        throw new HttpError(403, 'يرجى تأكيد البريد الإلكتروني أولًا', 'EMAIL_NOT_VERIFIED');
    }
    return session(row);
};

export const forgotPassword = ({ email }) => issueOtp(email, 'reset_password');

export const verifyResetOtp = async ({ email, otp_code: code }) => {
    await checkOtp(email, code, 'reset_password');
};

export const resetPassword = async ({ email, otp_code: code, new_password: newPassword }) => {
    const otpHash = await checkOtp(email, code, 'reset_password');
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Receiving the code proves ownership of the mailbox, so the email counts as verified.
    const { rowCount } = await pool.query(
        `UPDATE ngos
         SET password = $3, email_verified_at = COALESCE(email_verified_at, NOW()),
             otp_code = NULL, otp_purpose = NULL, otp_expires_at = NULL,
             otp_attempts = 0, updated_at = NOW()
         WHERE email = $1 AND otp_purpose = 'reset_password' AND otp_code = $2
           AND otp_expires_at > NOW()`,
        [email, otpHash, passwordHash]
    );
    if (!rowCount) throw invalidOtp();
};

/**
 * Attaches (or replaces) one registration document. The status is left alone: after an
 * admin asks for completion, the NGO resubmits explicitly (see resubmitForReview).
 */
export const attachNgoDocument = async (id, documentType, key) => {
    const document = DOCUMENTS.find((doc) => doc.key === documentType);
    if (!document) throw new HttpError(404, 'نوع المستند غير معروف', 'UNKNOWN_DOCUMENT');
    if (!(await fileExists(key))) {
        throw new HttpError(400, 'الملف غير موجود، ارفعه مرة أخرى', 'FILE_NOT_FOUND');
    }
    // document.column comes from the DOCUMENTS whitelist, never from the request.
    const { rows } = await pool.query(
        `UPDATE ngos SET ${document.column} = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING ${NGO_COLUMNS}`,
        [id, key]
    );
    if (!rows.length) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
    emitToAdmins(EVENTS.NGO_UPDATED, { ngoId: id });
    return toPublicNgo(rows[0]);
};

// Fields an NGO may correct itself. The email (login identity), the NGO name and the registration
// number are official records and stay fixed.
const PROFILE_FIELDS = {
    fieldOfWork: 'field_of_work',
    representativeName: 'representative_name',
    position: 'position',
    mobile: 'mobile',
};

export const updateNgoProfile = async (id, changes) => {
    const entries = Object.entries(PROFILE_FIELDS).filter(([field]) => changes[field] !== undefined);
    if (!entries.length) return getNgoProfile(id);
    // Column names come from PROFILE_FIELDS, never from the request.
    const assignments = entries.map(([, column], index) => `${column} = $${index + 2}`).join(', ');
    try {
        const { rows } = await pool.query(
            `UPDATE ngos SET ${assignments}, updated_at = NOW() WHERE id = $1 RETURNING ${NGO_COLUMNS}`,
            [id, ...entries.map(([field]) => changes[field] || null)]
        );
        if (!rows.length) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
        emitToAdmins(EVENTS.NGO_UPDATED, { ngoId: id });
        return toPublicNgo(rows[0]);
    } catch (error) {
        throw uniqueViolation(error);
    }
};

/** Sets (fileUrl from saveImage) or clears (null) the NGO's profile picture. */
export const setNgoAvatar = async (id, avatarUrl) => {
    const { rows } = await pool.query(
        `UPDATE ngos SET avatar_url = $2, updated_at = NOW() WHERE id = $1 RETURNING ${NGO_COLUMNS}`,
        [id, avatarUrl]
    );
    if (!rows.length) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
    emitToAdmins(EVENTS.NGO_UPDATED, { ngoId: id });
    return toPublicNgo(rows[0]);
};

/** After fixing what the admin asked for, the NGO sends the file back to review. */
export const resubmitForReview = async (id) => {
    const current = await pool.query(`SELECT ${NGO_COLUMNS} FROM ngos WHERE id = $1`, [id]);
    const row = current.rows[0];
    if (!row) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
    if (row.account_status !== 'needs_documents') {
        throw new HttpError(409, 'لا يوجد طلب استكمال مفتوح لإعادة الإرسال', 'NOT_AWAITING_COMPLETION');
    }
    if (!hasAllDocuments(row)) {
        throw new HttpError(400, 'يرجى رفع جميع المستندات المطلوبة أولًا', 'DOCUMENTS_MISSING');
    }
    // The NGO made this change itself, so it is not an unseen update for them.
    const { rows } = await pool.query(
        `UPDATE ngos SET account_status = 'under_review', status_updated_at = NOW(),
             status_seen_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND account_status = 'needs_documents'
         RETURNING ${NGO_COLUMNS}`,
        [id]
    );
    if (!rows.length) throw new HttpError(409, 'لا يوجد طلب استكمال مفتوح لإعادة الإرسال', 'NOT_AWAITING_COMPLETION');
    const ngo = toPublicNgo(rows[0]);
    emitToThread(id, EVENTS.NGO_STATUS, {
        ngoId: id, accountStatus: ngo.accountStatus, adminNotes: ngo.adminNotes, statusUpdatedAt: ngo.statusUpdatedAt,
    });
    return ngo;
};

/** Clears the "new status" indicator once the NGO has seen the latest update. */
export const markStatusSeen = async (id) => {
    const { rows } = await pool.query(
        `UPDATE ngos SET status_seen_at = NOW() WHERE id = $1 RETURNING ${NGO_COLUMNS}`, [id]
    );
    if (!rows.length) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
    return toPublicNgo(rows[0]);
};

export const getNgoProfile = async (id) => {
    const { rows } = await pool.query(`SELECT ${NGO_COLUMNS} FROM ngos WHERE id = $1`, [id]);
    if (!rows.length) throw new HttpError(404, 'الحساب غير موجود', 'NOT_FOUND');
    return toPublicNgo(rows[0]);
};
