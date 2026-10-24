import * as ngoAuth from '../services/ngoAuth.service.js';
import { handle } from '../utils/handle.js';

// Same generic answer whether or not the email exists, to prevent account enumeration.
const OTP_SENT_MESSAGE = 'إذا كان البريد مسجّلًا لدينا فسيصلك رمز التحقق خلال دقائق';

export const register = handle('ngo-auth register', 201, 'تم إنشاء الحساب، يرجى تأكيد البريد الإلكتروني',
    (req) => ngoAuth.registerNgo(req.body));

export const verifyEmail = handle('ngo-auth verify-email', 200, 'تم تأكيد البريد الإلكتروني',
    (req) => ngoAuth.verifyEmail(req.body));

export const resendVerification = handle('ngo-auth resend-verification', 200, OTP_SENT_MESSAGE,
    (req) => ngoAuth.resendVerification(req.body));

export const login = handle('ngo-auth login', 200, 'تم تسجيل الدخول بنجاح',
    (req) => ngoAuth.loginNgo(req.body));

export const forgotPassword = handle('ngo-auth forgot-password', 200, OTP_SENT_MESSAGE,
    (req) => ngoAuth.forgotPassword(req.body));

export const verifyOtp = handle('ngo-auth verify-otp', 200, 'رمز التحقق صحيح',
    async (req) => {
        await ngoAuth.verifyResetOtp(req.body);
        return { verified: true };
    });

export const resetPassword = handle('ngo-auth reset-password', 200, 'تم تغيير كلمة المرور بنجاح',
    (req) => ngoAuth.resetPassword(req.body));

export const attachDocument = handle('ngo-auth attach-document', 200, 'تم حفظ المستند',
    (req) => ngoAuth.attachNgoDocument(req.user.id, req.params.documentType, req.body.key));

export const getProfile = handle('ngo-auth profile', 200, 'تم جلب بيانات الحساب',
    (req) => ngoAuth.getNgoProfile(req.user.id));
