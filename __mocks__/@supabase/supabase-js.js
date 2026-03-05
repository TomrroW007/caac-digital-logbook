/**
 * Mock for @supabase/supabase-js for Jest test environment.
 * Provides a minimal no-op Supabase client.
 */

const createClient = jest.fn(() => ({
    auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
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
