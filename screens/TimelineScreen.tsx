/**
 * @file screens/TimelineScreen.tsx
 * @description Chronological list of all logbook records from WatermelonDB.
 * Uses reactive UI (withObservables) to auto-update on data changes.
 * Tapping a row navigates to EntryForm in edit mode.
 */

import React from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    Alert,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../App';
import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';
import { minutesToHHMM } from '../utils/TimeCalculator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Timeline'>;

const COLORS = {
    background: '#0A0F1E',
    card: '#1F2937',
    border: '#374151',
    primary: '#3B82F6',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    flight: '#3B82F6',
    sim: '#7C3AED',
    accent: '#60A5FA',
};

// ─── Component Props ──────────────────────────────────────────────────────────

/**
 * Props injected by withObservables.
 */
interface TimelineProps {
    logbooks: LogbookRecord[];
}

// ─── Presentational Component ─────────────────────────────────────────────────

const TimelineScreenBase: React.FC<TimelineProps> = ({ logbooks }) => {
    const navigation = useNavigation<Nav>();

    // ── Soft-delete: long-press → Alert → WatermelonDB write ──
    const handleDelete = (record: LogbookRecord) => {
        Alert.alert(
            'Delete Record',
            'Are you sure you want to delete this record? It will be excluded from Dashboard stats and exports.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        database.write(async () => {
                            await record.update(r => {
                                r.isDeleted = true;
                                // PRD §6: last_modified_at must be UTC — toISOString() is always UTC
                                r.lastModifiedAt = new Date().toISOString();
                            });
                        });
                    },
                },
            ]
        );
    };

    const renderItem = ({ item }: { item: LogbookRecord }) => (
        <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('EntryForm', { recordId: item.id })}
            onLongPress={() => handleDelete(item)}
            delayLongPress={500}
            testID={`record-row-${item.id}`}
        >
            <View style={styles.cardLeft}>
                <View style={[
                    styles.dutyBadge,
                    { backgroundColor: item.isFlight ? COLORS.flight : COLORS.sim }
                ]}>
                    <Text style={styles.dutyBadgeText}>
                        {item.isFlight ? <Ionicons name="airplane" size={18} color="#FFFFFF" /> : <Ionicons name="desktop-outline" size={18} color="#FFFFFF" />}
                    </Text>
                </View>
            </View>
            <View style={styles.cardCenter}>
                <Text style={styles.cardDate}>{item.actlDate}</Text>
                <Text style={styles.cardRoute}>
                    {item.isFlight && item.routeString
                        ? item.routeString
                        : item.acftType}
                </Text>
            </View>
            <View style={styles.cardRight}>
                <Text style={styles.cardTime}>{minutesToHHMM(item.blockTimeMin)}</Text>
                <Text style={styles.cardTimeLabel}>Block</Text>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <FlatList<LogbookRecord>
                data={logbooks}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                ListHeaderComponent={
                    logbooks.length > 0 ? (
                        <Text style={styles.hint}>
                            <Ionicons name="bulb-outline" size={12} />{' Long-press a record to delete'}
                        </Text>
                    ) : null
                }
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="clipboard-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 16 }} />
                        <Text style={styles.emptyTitle}>No Records Yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Tap "+ Add Record" on the Dashboard to log your first flight.
                        </Text>
                    </View>
                }
            />
        </View>
    );
};

// ─── Observable Binding ───────────────────────────────────────────────────────

/**
 * Higher-Order Component that subscribes to the WatermelonDB query.
 * Any insertions, updates, or soft-deletes matching this query will
 * trigger an automatic re-render of TimelineScreenBase at native 60fps.
 */
const enhance = withObservables([], () => ({
    // Observable query: all non-deleted records, ordered by actual date descending
    logbooks: database
        .get<LogbookRecord>('logbook_records')
        .query(
            Q.where('is_deleted', false),
            Q.sortBy('actl_date', Q.desc)
        )
        .observe(),
}));

export const TimelineScreen = enhance(TimelineScreenBase);
export default TimelineScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    list: { padding: 16 },

    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
    },
    cardLeft: { marginRight: 12 },
    dutyBadge: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dutyBadgeText: { fontSize: 16 },
    cardCenter: { flex: 1 },
    cardDate: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 },
    cardRoute: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
    cardRight: { alignItems: 'flex-end' },
    cardTime: { color: COLORS.accent, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
    cardTimeLabel: { color: COLORS.textSecondary, fontSize: 10, marginTop: 2 },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
    emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
    emptySubtitle: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },

    // UI/UX: long-press discoverability hint (PRD Phase 4)
    hint: {
        color: COLORS.textSecondary,
        fontSize: 11,
        textAlign: 'center',
        paddingVertical: 8,
        opacity: 0.6,
    },
});
