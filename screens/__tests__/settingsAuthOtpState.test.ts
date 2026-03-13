import {
    buildOtpAuthCache,
    resolveOtpRestore,
    getEmailStepButtonLabel,
    OTP_CACHE_TTL_MS,
    OTP_RESEND_COOLDOWN_SECONDS,
} from '../settingsAuthOtpState';

describe('SettingsScreen OTP scenario helpers', () => {
    it('builds OTP cache payload with 5-minute expiry window', () => {
        const now = 1000;
        const cache = buildOtpAuthCache(' pilot@example.com ', now);

        expect(cache).toEqual({
            email: 'pilot@example.com',
            authStep: 'OTP',
            sentAt: now,
            expiresAt: now + OTP_CACHE_TTL_MS,
        });
    });

    it('restores OTP step when cache is valid and computes resend cooldown', () => {
        const now = 10_000;
        const sentAt = now - 20_000;
        const raw = JSON.stringify({
            email: 'captain@example.com',
            authStep: 'OTP',
            sentAt,
            expiresAt: sentAt + OTP_CACHE_TTL_MS,
        });

        const result = resolveOtpRestore(raw, now);
        expect(result.shouldRestore).toBe(true);
        expect(result.email).toBe('captain@example.com');
        expect(result.cooldownSec).toBe(OTP_RESEND_COOLDOWN_SECONDS - 20);
    });

    it('returns non-restorable result when cache is expired', () => {
        const now = 1_000_000;
        const raw = JSON.stringify({
            email: 'captain@example.com',
            authStep: 'OTP',
            sentAt: now - OTP_CACHE_TTL_MS - 1000,
            expiresAt: now - 1,
        });

        const result = resolveOtpRestore(raw, now);
        expect(result).toEqual({ shouldRestore: false, email: '', cooldownSec: 0 });
    });

    it('returns non-restorable result for malformed cache payload', () => {
        const result = resolveOtpRestore('{bad-json', 100);
        expect(result).toEqual({ shouldRestore: false, email: '', cooldownSec: 0 });
    });

    it('provides button label for cooldown and normal state', () => {
        expect(getEmailStepButtonLabel(59)).toBe('重新发送 (59s)');
        expect(getEmailStepButtonLabel(0)).toBe('获取验证码');
    });
});
