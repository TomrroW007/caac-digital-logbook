export const AUTH_OTP_CACHE_KEY = 'settings_auth_otp_cache_v1';
export const OTP_CACHE_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export type OtpAuthCache = {
    email: string;
    authStep: 'OTP';
    sentAt: number;
    expiresAt: number;
};

export type OtpRestoreResult = {
    shouldRestore: boolean;
    email: string;
    cooldownSec: number;
};

export const buildOtpAuthCache = (email: string, now: number = Date.now()): OtpAuthCache => ({
    email: email.trim(),
    authStep: 'OTP',
    sentAt: now,
    expiresAt: now + OTP_CACHE_TTL_MS,
});

export const resolveOtpRestore = (
    raw: string | null,
    now: number = Date.now(),
): OtpRestoreResult => {
    if (!raw) return { shouldRestore: false, email: '', cooldownSec: 0 };

    try {
        const parsed = JSON.parse(raw) as OtpAuthCache;
        if (!parsed?.email || parsed.authStep !== 'OTP' || parsed.expiresAt <= now) {
            return { shouldRestore: false, email: '', cooldownSec: 0 };
        }

        const cooldownSec = Math.max(
            0,
            Math.ceil((parsed.sentAt + OTP_RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000),
        );

        return {
            shouldRestore: true,
            email: parsed.email,
            cooldownSec,
        };
    } catch {
        return { shouldRestore: false, email: '', cooldownSec: 0 };
    }
};

export const getEmailStepButtonLabel = (cooldownSec: number): string => {
    if (cooldownSec > 0) return `重新发送 (${cooldownSec}s)`;
    return '获取验证码';
};
