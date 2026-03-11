/**
 * @file screens/DashboardScreen.tsx
 * @description Dashboard with reactive observables for 90-day experience and totals.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
    Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../App';
import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';
import {
    validate90DayExperience,
    get90DayBoundaryDate,
    type ExperienceRecord,
} from '../utils/ComplianceValidator';
import { minutesToHHMM } from '../utils/TimeCalculator';
import { readSyncStatus, type SyncStatus } from '../utils/SyncService';
import { subscribeToAuthChanges } from '../utils/SyncService';
import { isSupabaseConfigured } from '../utils/supabaseClient';
import SyncStatusCapsule from '../components/shared/SyncStatusCapsule';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Dashboard'>;

const COLORS = {
    background: '#0A0F1E',
    surface: '#111827',
    card: '#1F2937',
    border: '#374151',
    primary: '#3B82F6',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    sim: '#7C3AED',
    accent: '#60A5FA',
};

// ─── Component Props ──────────────────────────────────────────────────────────

/**
 * Props injected by withObservables.
 */
interface DashboardProps {
    logbooks: LogbookRecord[];
}

// ─── Presentational Component ─────────────────────────────────────────────────

const DashboardScreenBase: React.FC<DashboardProps> = ({ logbooks }) => {
    const navigation = useNavigation<Nav>();

    // ── 云同步状态指示器（UI/UX: 每次屏幕联焦时刷新）──
    const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'local' });

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            readSyncStatus().then(s => {
                if (!cancelled) setSyncStatus(s);
            });
            return () => { cancelled = true; };
        }, []),
    );

    // ── Auth 状态订阅：登录/登出后实时刷新 SyncStatus（不依赖屏幕切换）──
    useEffect(() => {
        if (!isSupabaseConfigured()) return;
        const unsubscribe = subscribeToAuthChanges(session => {
            // session 为 null → 已登出，重置到 local 状态
            setSyncStatus(session ? { state: 'local' } : { state: 'local' });
            // 无论如何都立即刷新最新的持久化状态
            readSyncStatus().then(s => setSyncStatus(s));
        });
        return unsubscribe;
    }, []);

    // ── 90-Day Experience Calculation ──
    const experienceReport = useMemo(() => {
        const boundary = get90DayBoundaryDate();
        // Filter FLIGHT records within the last 90 days (Beijing-time baseline)
        const recentFlights = logbooks.filter(r =>
            r.isFlight && r.actlDate >= boundary
        );

        // Map to ExperienceRecord — includes dayTo/nightTo (Phase 1 schema v3)
        const experienceRecords: ExperienceRecord[] = recentFlights.map(r => ({
            dayTo: r.safeDayTo,
            nightTo: r.safeNightTo,
            dayLdg: r.dayLdg,
            nightLdg: r.nightLdg,
        }));

        return validate90DayExperience(experienceRecords);
    }, [logbooks]);

    // ── Total Time Calculations ──
    const { totalFlightMin, totalSimMin } = useMemo(() => {
        let fMin = 0;
        let sMin = 0;
        for (const r of logbooks) {
            if (r.isFlight) fMin += r.blockTimeMin;
            else sMin += r.blockTimeMin;
        }
        return { totalFlightMin: fMin, totalSimMin: sMin };
    }, [logbooks]);

    // ── Alert Card Theme ──
    const getAlertTheme = () => {
        switch (experienceReport.alertLevel) {
            case 'red': return { color: COLORS.error, bg: '#2A0E0E' };
            case 'yellow': return { color: COLORS.warning, bg: '#1C1A00' };
            case 'ok': return { color: COLORS.success, bg: '#0A1A0F' };
        }
    };
    const alertTheme = getAlertTheme();

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
            <ScrollView contentContainerStyle={styles.content}>

                {/* Web-only: iOS ITP data-loss warning — PRD PWA §4 */}
                {Platform.OS === 'web' && (
                    <View style={styles.itpWarning}>
                        <Text style={styles.itpWarningText}>
                            ⚠️ Web 版数据缓存在浏览器中。若长期未使用（iOS 限制 7 天）或清理缓存，数据可能丢失。请定期进入【设置与导出】生成 Excel 备份！
                        </Text>
                    </View>
                )}

                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.title}>✈ Pilot Logbook</Text>
                        <Text style={styles.subtitle}>Digital Pilot Logbook</Text>
                    </View>
                    <SyncStatusCapsule status={syncStatus} />
                </View>

                {/* 90-Day Experience Card — PRD §4.2 dual-row layout */}
                <View style={[styles.alertCard, { borderColor: alertTheme.color, backgroundColor: alertTheme.bg }]}>
                    <Text style={[styles.cardTitle, { color: alertTheme.color }]}>
                        {experienceReport.alertLevel === 'ok' ? '✅' : experienceReport.alertLevel === 'yellow' ? '⚠️' : '🚫'} 90-Day Currency
                    </Text>
                    <Text style={styles.cardSubtitle}>
                        {experienceReport.alertMessage}
                    </Text>

                    {/* Row 1: Takeoff totals (core) + day/night sub-labels */}
                    <View style={styles.expRow}>
                        <Text style={styles.expIcon}>🛫</Text>
                        <View style={styles.expMain}>
                            <Text style={[styles.expTotal, { color: alertTheme.color }]}>
                                {experienceReport.totalTo}
                            </Text>
                            <Text style={styles.expUnit}>Takeoffs (T/O)</Text>
                        </View>
                        <Text style={styles.expSub}>
                            Day: {experienceReport.dayTo} / Night: {experienceReport.nightTo}
                        </Text>
                    </View>

                    <View style={styles.expDivider} />

                    {/* Row 2: Landing totals (core) + day/night sub-labels */}
                    <View style={styles.expRow}>
                        <Text style={styles.expIcon}>🛬</Text>
                        <View style={styles.expMain}>
                            <Text style={[styles.expTotal, { color: alertTheme.color }]}>
                                {experienceReport.totalLdg}
                            </Text>
                            <Text style={styles.expUnit}>Landings (LDG)</Text>
                        </View>
                        <Text style={styles.expSub}>
                            Day: {experienceReport.dayLdg} / Night: {experienceReport.nightLdg}
                        </Text>
                    </View>
                </View>

                {/* Totals Cards */}
                <View style={styles.cardRow}>
                    <View style={styles.totalCard}>
                        <Text style={styles.totalIcon}>✈</Text>
                        <Text style={styles.totalLabel}>Total Block</Text>
                        <Text style={styles.totalValue}>{minutesToHHMM(totalFlightMin)}</Text>
                        <Text style={styles.totalUnit}>All Time</Text>
                    </View>
                    <View style={[styles.totalCard, { borderColor: COLORS.sim }]}>
                        <Text style={styles.totalIcon}>🖥</Text>
                        <Text style={styles.totalLabel}>Simulator</Text>
                        <Text style={styles.totalValue}>{minutesToHHMM(totalSimMin)}</Text>
                        <Text style={styles.totalUnit}>Total Time</Text>
                    </View>
                </View>

                {/* Quick Actions */}
                <View style={styles.actionsSection}>
                    <TouchableOpacity
                        style={styles.primaryAction}
                        onPress={() => navigation.navigate('EntryForm')}
                        testID="btn-new-entry"
                    >
                        <Text style={styles.primaryActionText}>+ Add Record</Text>
                    </TouchableOpacity>

                    <View style={styles.secondaryActions}>
                        <TouchableOpacity
                            style={styles.secondaryAction}
                            onPress={() => navigation.navigate('Timeline')}
                            testID="btn-timeline"
                        >
                            <Text style={styles.secondaryActionText}>Timeline</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.secondaryAction}
                            onPress={() => navigation.navigate('Settings')}
                            testID="btn-settings"
                        >
                            <Text style={styles.secondaryActionText}>Settings & Export</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

// ─── Observable Binding ───────────────────────────────────────────────────────

/**
 * High-Order Component subscribing to ALL non-deleted logbooks.
 * Changes to any Flight/Sim record will seamlessly trigger a re-render here
 * to recalculate the 90-day alert and the total block time counters.
 */
const enhance = withObservables([], () => ({
    logbooks: database
        .get<LogbookRecord>('logbook_records')
        .query(
            Q.where('is_deleted', false),
            Q.sortBy('actl_date', Q.desc),
        )
        .observe(),
}));

export const DashboardScreen = enhance(DashboardScreenBase);
export default DashboardScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    content: { padding: 20, paddingBottom: 40 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    headerLeft: { flex: 1 },
    title: { color: COLORS.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 4 },

    alertCard: {
        borderWidth: 1.5,
        borderRadius: 14,
        padding: 16,
        marginBottom: 16,
    },
    cardTitle: { fontWeight: '700', fontSize: 14 },
    cardSubtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 12 },

    // 90-day dual-row layout
    expRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    expIcon: { fontSize: 22, marginRight: 12 },
    expMain: { alignItems: 'center', marginRight: 16, minWidth: 56 },
    expTotal: { fontSize: 36, fontWeight: '800', lineHeight: 40 },
    expUnit: { color: COLORS.textSecondary, fontSize: 10, marginTop: 2 },
    expSub: {
        flex: 1,
        color: COLORS.textSecondary,
        fontSize: 12,
        lineHeight: 20,
    },
    expDivider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: 4 },

    cardRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
    totalCard: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.primary,
        borderRadius: 14,
        padding: 16,
        alignItems: 'center',
    },
    totalIcon: { fontSize: 24, marginBottom: 8 },
    totalLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
    totalValue: { color: COLORS.text, fontSize: 28, fontWeight: '800', marginTop: 4 },
    totalUnit: { color: COLORS.textSecondary, fontSize: 11 },

    actionsSection: { gap: 12 },
    primaryAction: {
        backgroundColor: COLORS.primary,
        borderRadius: 14,
        paddingVertical: 18,
        alignItems: 'center',
    },
    primaryActionText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    secondaryActions: { flexDirection: 'row', gap: 12 },
    secondaryAction: {
        flex: 1,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
    },
    secondaryActionText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },

    // Web-only: iOS ITP data-loss warning banner
    itpWarning: {
        backgroundColor: '#332B00',
        borderWidth: 1,
        borderColor: '#F59E0B',
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
    },
    itpWarningText: {
        color: '#FDE68A',
        fontSize: 12,
        lineHeight: 18,
    },
});
