/**
 * Mock for @supabase/supabase-js for Jest test environment.
 * Provides a minimal no-op Supabase client.
 *
 * Phase 7: Added getSession, onAuthStateChange, signInWithPassword,
 * signUp, and signOut to support SettingsScreen and SyncService auth flows.
 */

const createClient = jest.fn(() => ({
    auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
        getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: jest.fn().mockReturnValue({
            data: {
                subscription: { unsubscribe: jest.fn() },
            },
        }),
        signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }),
        signUp: jest.fn().mockResolvedValue({ data: {}, error: null }),
        signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        upsert: jest.fn().mockResolvedValue({ error: null }),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gt: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
}));

module.exports = { createClient };
