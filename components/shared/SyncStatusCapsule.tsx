/**
 * @file components/shared/SyncStatusCapsule.tsx
 * @description Phase 7: Sync Status Capsule widget for the Dashboard header.
 *
 * Displays one of 4 states per PRD §7 UI/UX spec:
 *   ⬜ Local Mode  (Gray)  — Supabase not configured or user not logged in
 *   🟩 Synced      (Green) — Logged in and last sync succeeded
 *   🟨 Syncing     (Amber) — Sync operation in progress
 *   🟥 Error       (Red)   — Network failure or sync error
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { isSupabaseConfigured } from '../../utils/supabaseClient';
import type { SyncStatus } from '../../utils/SyncService';

interface Props {
    status: SyncStatus;
}

const COLORS = {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    muted: '#9CA3AF',
};

const SyncStatusCapsule: React.FC<Props> = ({ status }) => {
    let dot: string;
    let label: string;
    let color: string;

    if (!isSupabaseConfigured()) {
        dot = '⬜';
        label = 'Local';
        color = COLORS.muted;
    } else {
        switch (status.state) {
            case 'synced':
                dot = '🟩';
                label = 'Synced';
                color = COLORS.success;
                break;
            case 'syncing':
                dot = '🟨';
                label = 'Syncing…';
                color = COLORS.warning;
                break;
            case 'error':
                dot = '🟥';
                label = 'Sync Error';
                color = COLORS.error;
                break;
            default: // 'local' — configured but not signed in
                dot = '⬜';
                label = 'Not Signed In';
                color = COLORS.muted;
        }
    }

    return (
        <View style={styles.capsule}>
            <Text style={styles.dot}>{dot}</Text>
            <Text style={[styles.label, { color }]}>{label}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    capsule: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 12,
        paddingTop: 2,
    },
    dot: { fontSize: 14, lineHeight: 20 },
    label: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});

export default SyncStatusCapsule;
