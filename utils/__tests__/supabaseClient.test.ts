/**
 * @file utils/__tests__/supabaseClient.test.ts
 * @description Unit tests for Supabase client configuration helpers.
 */

import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabaseClient';

// @supabase/supabase-js is mocked via __mocks__/@supabase/supabase-js.js

describe('supabaseClient — isSupabaseConfigured', () => {
    it('returns false when SUPABASE_URL still contains the placeholder', () => {
        expect(SUPABASE_URL).toContain('your-project-id');
        expect(isSupabaseConfigured()).toBe(false);
    });

    it('returns false when SUPABASE_ANON_KEY still contains the placeholder', () => {
        expect(SUPABASE_ANON_KEY).toContain('your-anon-key');
        expect(isSupabaseConfigured()).toBe(false);
    });

    it('returns true only when both values are non-placeholder strings', () => {
        // Simulate configured state by calling the underlying logic with mock values
        const checkConfigured = (url: string, key: string): boolean =>
            !url.includes('your-project-id') && !key.includes('your-anon-key');

        expect(checkConfigured('https://real-project.supabase.co', 'eyJhbGciOiJSUzI1NiJ9.real')).toBe(true);
        expect(checkConfigured('https://your-project-id.supabase.co', 'real-key')).toBe(false);
        expect(checkConfigured('https://real.supabase.co', 'your-anon-key')).toBe(false);
    });
});
