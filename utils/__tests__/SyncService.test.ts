/**
 * @file utils/__tests__/SyncService.test.ts
 * @description Unit tests for SyncService — covering the unconfigured path and
 *              the offline-first defensive guards that don't require a live network.
 *
 * Network / WatermelonDB-sync paths are integration-tested in e2e; we only
 * unit-test the pure control-flow branches here.
 */

// ─── Module-level mocks (must precede imports) ────────────────────────────────

// Supabase is mocked via __mocks__/@supabase/supabase-js.js
// WatermelonDB sync is mocked via __mocks__/@nozbe/watermelondb/sync.js

jest.mock('../../database', () => ({
    database: {},
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { readSyncStatus, syncWithCloud, type SyncStatus } from '../SyncService';

// ─────────────────────────────────────────────────────────────────────────────
// readSyncStatus — unconfigured Supabase
// ─────────────────────────────────────────────────────────────────────────────

describe('readSyncStatus', () => {
    it('returns { state: "local" } when Supabase is not configured (placeholder values)', async () => {
        const status: SyncStatus = await readSyncStatus();
        // The default supabaseClient.ts has placeholder values → not configured
        expect(status.state).toBe('local');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncWithCloud — unconfigured Supabase (early-exit guard)
// ─────────────────────────────────────────────────────────────────────────────

describe('syncWithCloud', () => {
    it('returns { state: "local" } immediately when Supabase is not configured', async () => {
        const result = await syncWithCloud();
        expect(result.state).toBe('local');
    });

    it('does not call synchronize() when Supabase is not configured', async () => {
        // synchronize is mocked via __mocks__/@nozbe/watermelondb/sync.js
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { synchronize } = require('@nozbe/watermelondb/sync');
        (synchronize as jest.Mock).mockClear();

        await syncWithCloud();
        expect(synchronize).not.toHaveBeenCalled();
    });
});
