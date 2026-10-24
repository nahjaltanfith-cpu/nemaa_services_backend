import crypto from 'node:crypto';

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

// DEV_FIXED_OTP (e.g. 111111) makes every code predictable for manual testing; development only.
export const generateOtp = () => {
    const fixed = process.env.DEV_FIXED_OTP?.trim();
    if (process.env.NODE_ENV === 'development' && /^\d{6}$/.test(fixed ?? '')) return fixed;
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
};

// Keyed hash: a leaked database alone is not enough to brute-force the 6-digit codes.
export const hashOtp = (code) =>
    crypto.createHmac('sha256', process.env.JWT_SECRET).update(code).digest('hex');

export const otpMatches = (code, storedHash) => {
    if (!storedHash) return false;
    const actual = Buffer.from(hashOtp(code), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
