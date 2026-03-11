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
import { Ionicons } from '@expo/vector-icons';

import { isSupabaseConfigured } from '../../utils/supabaseClient';
import type { SyncStatus } from '../../utils/SyncService';

interface Props {
    status: SyncStatus;
    isSignedIn: boolean;
}

const COLORS = {
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    muted: '#9CA3AF',
    ready: '#3B82F6',
};

const SyncStatusCapsule: React.FC<Props> = ({ status, isSignedIn }) => {
    let dot: React.ReactNode;
    let label: string;
    let color: string;

    if (!isSupabaseConfigured()) {
        dot = <Ionicons name="cloud-offline-outline" size={14} color={COLORS.muted} />;
        label = 'Local';
        color = COLORS.muted;
    } else {
        switch (status.state) {
            case 'synced':
                dot = <Ionicons name="cloud-done" size={14} color={COLORS.success} />;
                label = 'Synced';
                color = COLORS.success;
                break;
            case 'syncing':
                dot = <Ionicons name="sync" size={14} color={COLORS.warning} />;
                label = 'Syncing…';
                color = COLORS.warning;
                break;
            case 'error':
                dot = <Ionicons name="warning" size={14} color={COLORS.error} />;
                label = 'Sync Error';
                color = COLORS.error;
                break;
            default: // 'local' — configured but not signed in OR signed in but no sync yet
                if (isSignedIn) {
                    dot = <Ionicons name="cloud-outline" size={14} color={COLORS.ready} />;
                    label = 'Cloud Ready';
                    color = COLORS.ready;
                } else {
                    dot = <Ionicons name="cloud-offline-outline" size={14} color={COLORS.muted} />;
                    label = 'Not Signed In';
                    color = COLORS.muted;
                }
        }
    }

    return (
        <View style={styles.capsule}>
            {dot}
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
    label: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});

export default SyncStatusCapsule;
