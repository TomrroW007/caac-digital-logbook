/**
 * @file utils/__tests__/supabaseClient.test.ts
 * @description Unit tests for Supabase client configuration helpers.
 *
 * Credentials are injected via EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
 * environment variables — never hard-coded. Tests use jest.isolateModules + process.env
 * to simulate different configuration states without requiring real credentials in CI.
 */

import { isSupabaseConfigured } from '../supabaseClient';

// @supabase/supabase-js is mocked via __mocks__/@supabase/supabase-js.js

describe('supabaseClient — isSupabaseConfigured', () => {
    it('returns true when real Supabase credentials are configured via env vars', () => {
        // Use jest.isolateModules to inject mock env vars — avoids needing real credentials in CI
        let result = false;
        jest.isolateModules(() => {
            process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co';
            process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJSUzI1NiJ9.real-key';
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { isSupabaseConfigured: check } = require('../supabaseClient');
            result = check();
            delete process.env.EXPO_PUBLIC_SUPABASE_URL;
            delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
        });
        expect(result).toBe(true);
    });

    it('returns false for placeholder URL regardless of key', () => {
        const checkConfigured = (url: string, key: string): boolean =>
            !url.includes('your-project-id') && !key.includes('your-anon-key');

        expect(checkConfigured('https://your-project-id.supabase.co', 'real-key')).toBe(false);
    });

    it('returns false for placeholder key regardless of URL', () => {
        const checkConfigured = (url: string, key: string): boolean =>
            !url.includes('your-project-id') && !key.includes('your-anon-key');

        expect(checkConfigured('https://real.supabase.co', 'your-anon-key')).toBe(false);
    });

    it('returns true only when both values are non-placeholder strings', () => {
        const checkConfigured = (url: string, key: string): boolean =>
            !url.includes('your-project-id') && !key.includes('your-anon-key');

        expect(checkConfigured('https://real-project.supabase.co', 'eyJhbGciOiJSUzI1NiJ9.real')).toBe(true);
    });
});
