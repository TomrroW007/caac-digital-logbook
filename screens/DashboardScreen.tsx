/**
 * @file screens/DashboardScreen.tsx
 * @description Dashboard with reactive observables for 90-day experience and totals.
 */

import React, { useMemo } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../App';
import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';
import {
    validate90DayExperience,
    get90DayBoundaryDate,
    type LandingRecord
} from '../utils/ComplianceValidator';
import { minutesToHHMM } from '../utils/TimeCalculator';

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

    // ── 90-Day Experience Calculation ──
    const experienceReport = useMemo(() => {
        const boundary = get90DayBoundaryDate();
        // Filter FLIGHT records within the last 90 days
        const recentFlights = logbooks.filter(r =>
            r.isFlight && r.actlDate >= boundary
        );

        // Map to exact required shape for pure function
        const landingRecords: LandingRecord[] = recentFlights.map(r => ({
            dayLdg: r.dayLdg,
            nightLdg: r.nightLdg,
        }));

        return validate90DayExperience(landingRecords);
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

                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>✈ CAAC Digital Logbook</Text>
                    <Text style={styles.subtitle}>飞行员电子飞行记录本</Text>
                </View>

                {/* 90-Day Experience Card */}
                <View style={[styles.alertCard, { borderColor: alertTheme.color, backgroundColor: alertTheme.bg }]}>
                    <Text style={[styles.cardTitle, { color: alertTheme.color }]}>
                        {experienceReport.alertLevel === 'ok' ? '✅' : '⚠'} 近90天近期经历
                    </Text>
                    <Text style={styles.cardSubtitle}>
                        {experienceReport.alertMessage}
                    </Text>
                    <View style={styles.ldgRow}>
                        <View style={styles.ldgCell}>
                            <Text style={styles.ldgValue}>{experienceReport.dayLdg}</Text>
                            <Text style={styles.ldgLabel}>昼间落地</Text>
                        </View>
                        <View style={styles.ldgDivider} />
                        <View style={styles.ldgCell}>
                            <Text style={styles.ldgValue}>{experienceReport.nightLdg}</Text>
                            <Text style={styles.ldgLabel}>夜间落地</Text>
                        </View>
                    </View>
                </View>

                {/* Totals Cards */}
                <View style={styles.cardRow}>
                    <View style={styles.totalCard}>
                        <Text style={styles.totalIcon}>✈</Text>
                        <Text style={styles.totalLabel}>真实飞行</Text>
                        <Text style={styles.totalValue}>{minutesToHHMM(totalFlightMin)}</Text>
                        <Text style={styles.totalUnit}>总时长</Text>
                    </View>
                    <View style={[styles.totalCard, { borderColor: COLORS.sim }]}>
                        <Text style={styles.totalIcon}>🖥</Text>
                        <Text style={styles.totalLabel}>模拟机</Text>
                        <Text style={styles.totalValue}>{minutesToHHMM(totalSimMin)}</Text>
                        <Text style={styles.totalUnit}>总时长</Text>
                    </View>
                </View>

                {/* Quick Actions */}
                <View style={styles.actionsSection}>
                    <TouchableOpacity
                        style={styles.primaryAction}
                        onPress={() => navigation.navigate('EntryForm')}
                        testID="btn-new-entry"
                    >
                        <Text style={styles.primaryActionText}>+ 新建记录</Text>
                    </TouchableOpacity>

                    <View style={styles.secondaryActions}>
                        <TouchableOpacity
                            style={styles.secondaryAction}
                            onPress={() => navigation.navigate('Timeline')}
                            testID="btn-timeline"
                        >
                            <Text style={styles.secondaryActionText}>📋 历史记录</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.secondaryAction}
                            onPress={() => navigation.navigate('Settings')}
                            testID="btn-settings"
                        >
                            <Text style={styles.secondaryActionText}>📤 导出设置</Text>
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
        .query(Q.where('is_deleted', false))
        .observe(),
}));

export const DashboardScreen = enhance(DashboardScreenBase);
export default DashboardScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    content: { padding: 20, paddingBottom: 40 },
    header: { marginBottom: 24 },
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
    ldgRow: { flexDirection: 'row', alignItems: 'center' },
    ldgCell: { flex: 1, alignItems: 'center' },
    ldgValue: { color: COLORS.text, fontSize: 32, fontWeight: '800' },
    ldgLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
    ldgDivider: { width: 1, height: 48, backgroundColor: COLORS.border },

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
});
