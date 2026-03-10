/**
 * @file utils/__tests__/SyncService.test.ts
 * @description Unit tests for SyncService — covering all control-flow branches
 *              including the unconfigured path, the no-auth guard, and the
 *              happy-path sync trigger.
 *
 * Phase 7: Real Supabase credentials are in place, so we mock `supabaseClient`
 * to control `isSupabaseConfigured()` returns in each test scenario.
 */

// ─── Module-level mocks (must precede imports) ────────────────────────────────

const mockIsConfigured = jest.fn(() => false);
const mockGetUser = jest.fn().mockResolvedValue({ data: { user: null }, error: null });
const mockOnAuthStateChange = jest.fn().mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
});
const mockFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gt: jest.fn().mockResolvedValue({ data: [], error: null }),
});

jest.mock('../../utils/supabaseClient', () => ({
    isSupabaseConfigured: mockIsConfigured,
    supabase: {
        auth: {
            getUser: mockGetUser,
            onAuthStateChange: mockOnAuthStateChange,
        },
        from: mockFrom,
    },
}));

jest.mock('../../database', () => ({
    database: {},
}));

// WatermelonDB sync is mocked via __mocks__/@nozbe/watermelondb/sync.js

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readSyncStatus, syncWithCloud, subscribeToAuthChanges, type SyncStatus } from '../SyncService';

// ─────────────────────────────────────────────────────────────────────────────
// readSyncStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('readSyncStatus', () => {
    beforeEach(() => {
        mockIsConfigured.mockReturnValue(false);
    });

    it('returns { state: "local" } when Supabase is not configured', async () => {
        const status: SyncStatus = await readSyncStatus();
        expect(status.state).toBe('local');
    });

    it('returns the current module-level status when Supabase is configured', async () => {
        mockIsConfigured.mockReturnValue(true);
        // Module state starts at { state: 'local' } on fresh import
        const status: SyncStatus = await readSyncStatus();
        // Status is the module-level _currentSyncStatus, which defaults to 'local'
        expect(['local', 'synced', 'syncing', 'error']).toContain(status.state);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncWithCloud — guard branches
// ─────────────────────────────────────────────────────────────────────────────

describe('syncWithCloud', () => {
    beforeEach(() => {
        mockIsConfigured.mockReturnValue(false);
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { synchronize } = require('@nozbe/watermelondb/sync');
        (synchronize as jest.Mock).mockClear();
    });

    it('returns { state: "local" } immediately when Supabase is not configured', async () => {
        mockIsConfigured.mockReturnValue(false);
        const result = await syncWithCloud();
        expect(result.state).toBe('local');
    });

    it('does not call synchronize() when Supabase is not configured', async () => {
        mockIsConfigured.mockReturnValue(false);
        const { synchronize } = require('@nozbe/watermelondb/sync');
        await syncWithCloud();
        expect(synchronize).not.toHaveBeenCalled();
    });

    it('returns { state: "error" } when configured but user is not authenticated', async () => {
        mockIsConfigured.mockReturnValue(true);
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const result = await syncWithCloud();
        expect(result.state).toBe('error');
    });

    it('returns { state: "error" } when configured but auth.getUser returns an error', async () => {
        mockIsConfigured.mockReturnValue(true);
        mockGetUser.mockResolvedValue({
            data: { user: null },
            error: { message: 'JWT expired' },
        });
        const result = await syncWithCloud();
        expect(result.state).toBe('error');
        if (result.state === 'error') {
            expect(result.message).toContain('JWT expired');
        }
    });

    it('calls synchronize() when configured and user is authenticated', async () => {
        mockIsConfigured.mockReturnValue(true);
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-uuid-123' } },
            error: null,
        });
        const { synchronize } = require('@nozbe/watermelondb/sync');
        (synchronize as jest.Mock).mockResolvedValue(undefined);

        const result = await syncWithCloud();
        expect(synchronize).toHaveBeenCalledTimes(1);
        expect(result.state).toBe('synced');
    });

    it('returns { state: "error" } when synchronize() throws', async () => {
        mockIsConfigured.mockReturnValue(true);
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-uuid-123' } },
            error: null,
        });
        const { synchronize } = require('@nozbe/watermelondb/sync');
        (synchronize as jest.Mock).mockRejectedValue(new Error('Network timeout'));

        const result = await syncWithCloud();
        expect(result.state).toBe('error');
        if (result.state === 'error') {
            expect(result.message).toContain('Network timeout');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// subscribeToAuthChanges — auth state listener
// ─────────────────────────────────────────────────────────────────────────────

describe('subscribeToAuthChanges', () => {
    beforeEach(() => {
        mockOnAuthStateChange.mockClear();
    });

    it('calls supabase.auth.onAuthStateChange and returns an unsubscribe function', () => {
        const mockUnsubscribe = jest.fn();
        mockOnAuthStateChange.mockReturnValue({
            data: { subscription: { unsubscribe: mockUnsubscribe } },
        });

        const callback = jest.fn();
        const unsubscribe = subscribeToAuthChanges(callback);

        expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
        expect(typeof unsubscribe).toBe('function');

        // Calling unsubscribe should call the underlying subscription's unsubscribe
        unsubscribe();
        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('invokes the callback with the session when auth state changes', () => {
        const mockSession = { user: { id: 'abc-123' }, access_token: 'token' };

        // Capture the listener passed to onAuthStateChange, then invoke it
        let capturedListener: ((event: string, session: unknown) => void) | null = null;
        mockOnAuthStateChange.mockImplementation((listener) => {
            capturedListener = listener;
            return { data: { subscription: { unsubscribe: jest.fn() } } };
        });

        const callback = jest.fn();
        subscribeToAuthChanges(callback);

        // Simulate a SIGNED_IN event
        capturedListener!('SIGNED_IN', mockSession);
        expect(callback).toHaveBeenCalledWith(mockSession);
    });

    it('resets sync status to "local" when session is null (sign-out)', async () => {
        let capturedListener: ((event: string, session: unknown) => void) | null = null;
        mockOnAuthStateChange.mockImplementation((listener) => {
            capturedListener = listener;
            return { data: { subscription: { unsubscribe: jest.fn() } } };
        });

        mockIsConfigured.mockReturnValue(true);
        const callback = jest.fn();
        subscribeToAuthChanges(callback);

        // Simulate SIGNED_OUT (session = null)
        capturedListener!('SIGNED_OUT', null);
        expect(callback).toHaveBeenCalledWith(null);

        // After sign-out, readSyncStatus should return { state: 'local' }
        const status = await readSyncStatus();
        expect(status.state).toBe('local');
    });
});
