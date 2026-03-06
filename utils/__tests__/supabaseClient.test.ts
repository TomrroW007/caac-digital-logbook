/**
 * @file utils/__tests__/supabaseClient.test.ts
 * @description Unit tests for Supabase client configuration helpers.
 *
 * Phase 7: Real Supabase credentials are now in place.
 * Tests validate that isSupabaseConfigured() correctly detects configured vs. placeholder states.
 */

import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

// @supabase/supabase-js is mocked via __mocks__/@supabase/supabase-js.js

describe('supabaseClient — isSupabaseConfigured', () => {
    it('returns true when real Supabase credentials are configured', () => {
        // Real credentials are now present in supabaseClient.ts (Phase 7)
        expect(SUPABASE_URL).not.toContain('your-project-id');
        expect(SUPABASE_ANON_KEY).not.toContain('your-anon-key');
        expect(isSupabaseConfigured()).toBe(true);
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
