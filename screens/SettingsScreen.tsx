/**
 * @file screens/SettingsScreen.tsx
 * @description Settings & Export screen — Phase 4: PDF (expo-print) and Excel (SheetJS).
 *
 * PRD §五: Dual-format export.
 *   - PDF: A4 landscape, CCAR-61 column headers, pilot/instructor signature area.
 *   - Excel: Clean data table with standard headers for personal backup.
 *
 * Export flow (both formats):
 *   1. Query all non-deleted logbook records from WatermelonDB (via withObservables).
 *   2. Generate the file in memory.
 *   3. Write to expo FileSystem temp directory.
 *   4. Call expo-sharing to hand off to the OS share sheet.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
    ActivityIndicator,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import * as XLSX from 'xlsx';

import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';
import { minutesToHHMM } from '../utils/TimeCalculator';

// ─── PDF HTML Generation ──────────────────────────────────────────────────────

function generateLogbookHtml(records: LogbookRecord[]): string {
    const rowsHtml = records.map(r => `
    <tr>
      <td>${r.schdDate}</td>
      <td>${r.actlDate}</td>
      <td>${r.acftType}</td>
      <td>${r.regNo ?? ''}</td>
      <td>${r.dutyType === 'FLIGHT' ? (r.routeString || '—') : (r.simNo ?? r.simCat ?? '模拟机')}</td>
      <td>${r.offTimeUtc ? r.offTimeUtc.slice(11, 16) : ''}</td>
      <td>${r.toTimeUtc  ? r.toTimeUtc.slice(11, 16)  : ''}</td>
      <td>${r.ldgTimeUtc ? r.ldgTimeUtc.slice(11, 16) : ''}</td>
      <td>${r.onTimeUtc  ? r.onTimeUtc.slice(11, 16)  : ''}</td>
      <td>${minutesToHHMM(r.blockTimeMin)}</td>
      <td>${minutesToHHMM(r.picMin)}</td>
      <td>${minutesToHHMM(r.sicMin)}</td>
      <td>${minutesToHHMM(r.dualMin)}</td>
      <td>${minutesToHHMM(r.instructorMin)}</td>
      <td>${r.nightFlightMin > 0 ? minutesToHHMM(r.nightFlightMin) : ''}</td>
      <td>${r.instrumentMin > 0  ? minutesToHHMM(r.instrumentMin)  : ''}</td>
      <td>${r.dayLdg > 0   ? r.dayLdg   : ''}</td>
      <td>${r.nightLdg > 0 ? r.nightLdg : ''}</td>
      <td>${r.pilotRole ?? ''}</td>
      <td>${r.approachType ?? ''}</td>
      <td>${r.exportRemarks}</td>
    </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <style>
    @page { size: A4 landscape; margin: 12mm 10mm; }
    body  { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #111; }
    h1    { font-size: 13pt; text-align: center; margin-bottom: 4px; }
    h2    { font-size: 9pt;  text-align: center; color: #555; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th    { background: #1e3a5f; color: #fff; font-size: 7pt; padding: 3px 2px; text-align: center; border: 1px solid #999; }
    td    { padding: 2px 2px; text-align: center; border: 1px solid #ccc; font-size: 7.5pt; }
    tr:nth-child(even) { background: #f5f8ff; }
    .sig  { margin-top: 20px; display: flex; justify-content: space-between; }
    .sig-box { border-top: 1px solid #333; width: 200px; padding-top: 4px; font-size: 8pt; color: #555; }
  </style>
</head>
<body>
  <h1>飞行记录本 PILOT LOGBOOK</h1>
  <h2>依据 CCAR-61 部 · 共 ${records.length} 条记录 · 导出时间: ${new Date().toLocaleString('zh-CN')}</h2>
  <table>
    <thead>
      <tr>
        <th>计划日期</th><th>实际日期</th><th>机型</th><th>注册号</th>
        <th>航段/机型</th>
        <th>OFF UTC</th><th>TO UTC</th><th>LDG UTC</th><th>ON UTC</th>
        <th>Block</th><th>PIC</th><th>SIC</th><th>带飞</th><th>教员</th>
        <th>夜航</th><th>仪表</th><th>昼落</th><th>夜落</th>
        <th>角色</th><th>进近类型</th><th>备注</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="sig">
    <div class="sig-box">飞行员签字 Pilot Signature</div>
    <div class="sig-box">教员签字 Instructor Signature</div>
    <div class="sig-box">审核人签字 Check Signature</div>
  </div>
</body>
</html>`;
}

// ─── Excel Row Mapper ─────────────────────────────────────────────────────────

function recordsToXlsxRows(records: LogbookRecord[]) {
    return records.map(r => ({
        '计划日期':    r.schdDate,
        '实际日期':    r.actlDate,
        '机型':        r.acftType,
        '注册号':      r.regNo ?? '',
        '航段/SIM':    r.dutyType === 'FLIGHT' ? r.routeString : (r.simNo ?? ''),
        '航班号':      r.flightNo ?? '',
        'OFF(UTC)':    r.offTimeUtc,
        'TO(UTC)':     r.toTimeUtc ?? '',
        'LDG(UTC)':    r.ldgTimeUtc ?? '',
        'ON(UTC)':     r.onTimeUtc,
        'Block(min)':  r.blockTimeMin,
        'PIC(min)':    r.picMin,
        'SIC(min)':    r.sicMin,
        '带飞(min)':   r.dualMin,
        '教员(min)':   r.instructorMin,
        '夜航(min)':   r.nightFlightMin,
        '仪表(min)':   r.instrumentMin,
        '昼间落地':    r.dayLdg,
        '夜间落地':    r.nightLdg,
        '角色':        r.pilotRole ?? '',
        '进近类型':    r.approachType ?? '',
        'SIM等级':     r.simCat ?? '',
        '训练机构':    r.trainingAgency ?? '',
        '训练类型':    r.trainingType ?? '',
        '备注':        r.exportRemarks,
        'Block(H:M)':  minutesToHHMM(r.blockTimeMin),
    }));
}

// ─── Component Props ──────────────────────────────────────────────────────────

interface SettingsProps {
    logbooks: LogbookRecord[];
}

// ─── Presentational Component ─────────────────────────────────────────────────

const COLORS = {
    background: '#0A0F1E',
    card: '#1F2937',
    border: '#374151',
    primary: '#3B82F6',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    accent: '#60A5FA',
    warning: '#F59E0B',
    success: '#22C55E',
};

const SettingsScreenBase: React.FC<SettingsProps> = ({ logbooks }) => {
    const [exportingPdf, setExportingPdf] = useState(false);
    const [exportingExcel, setExportingExcel] = useState(false);

    // ── PDF Export ───────────────────────────────────────────────────────────
    const handlePdfExport = async () => {
        if (logbooks.length === 0) {
            Alert.alert('无记录', '暂无可导出的飞行记录。');
            return;
        }
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
            Alert.alert('不支持', '当前设备不支持文件分享功能。');
            return;
        }
        setExportingPdf(true);
        try {
            const html = generateLogbookHtml(logbooks);
            const { uri } = await Print.printToFileAsync({ html, base64: false });
            const destUri = `${FileSystem.cacheDirectory}logbook_${Date.now()}.pdf`;
            await FileSystem.moveAsync({ from: uri, to: destUri });
            await Sharing.shareAsync(destUri, {
                mimeType: 'application/pdf',
                dialogTitle: '导出 CCAR-61 飞行记录本 PDF',
                UTI: 'com.adobe.pdf',
            });
        } catch (err) {
            console.error('[SettingsScreen] PDF export error:', err);
            Alert.alert('导出失败', 'PDF 生成时发生错误，请重试。');
        } finally {
            setExportingPdf(false);
        }
    };

    // ── Excel Export ─────────────────────────────────────────────────────────
    const handleExcelExport = async () => {
        if (logbooks.length === 0) {
            Alert.alert('无记录', '暂无可导出的飞行记录。');
            return;
        }
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
            Alert.alert('不支持', '当前设备不支持文件分享功能。');
            return;
        }
        setExportingExcel(true);
        try {
            const rows = recordsToXlsxRows(logbooks);
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Logbook');
            const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
            const destUri = `${FileSystem.cacheDirectory}logbook_${Date.now()}.xlsx`;
            await FileSystem.writeAsStringAsync(destUri, b64, {
                encoding: FileSystem.EncodingType.Base64,
            });
            await Sharing.shareAsync(destUri, {
                mimeType:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                dialogTitle: '导出飞行记录本 Excel',
                UTI: 'com.microsoft.excel.xlsx',
            });
        } catch (err) {
            console.error('[SettingsScreen] Excel export error:', err);
            Alert.alert('导出失败', 'Excel 生成时发生错误，请重试。');
        } finally {
            setExportingExcel(false);
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>

            <Text style={styles.sectionHeader}>导出选项</Text>

            {/* PDF Export */}
            <TouchableOpacity
                style={[styles.exportCard, exportingPdf && styles.exportCardDisabled]}
                onPress={handlePdfExport}
                disabled={exportingPdf || exportingExcel}
                testID="btn-export-pdf"
            >
                <Text style={styles.exportIcon}>📄</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>导出标准 PDF（打印版）</Text>
                    <Text style={styles.exportDesc}>
                        严格复刻 CCAR-61 标准列头，含飞行员/教员签字栏，可直接提交局方审查
                    </Text>
                    <Text style={styles.exportCount}>
                        {logbooks.length} 条记录 · A4 横向
                    </Text>
                </View>
                {exportingPdf
                    ? <ActivityIndicator size="small" color={COLORS.primary} />
                    : <Text style={styles.exportArrow}>›</Text>}
            </TouchableOpacity>

            {/* Excel Export */}
            <TouchableOpacity
                style={[styles.exportCard, exportingExcel && styles.exportCardDisabled]}
                onPress={handleExcelExport}
                disabled={exportingPdf || exportingExcel}
                testID="btn-export-excel"
            >
                <Text style={styles.exportIcon}>📊</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>导出 Excel（数据备份）</Text>
                    <Text style={styles.exportDesc}>
                        原始数据表格，含标准表头，用于个人备份与电脑端二次编辑
                    </Text>
                    <Text style={styles.exportCount}>
                        {logbooks.length} 条记录 · .xlsx 格式
                    </Text>
                </View>
                {exportingExcel
                    ? <ActivityIndicator size="small" color={COLORS.success} />
                    : <Text style={styles.exportArrow}>›</Text>}
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>关于</Text>

            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>版本</Text>
                <Text style={styles.infoValue}>V1.0.0 (Phase 4)</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>合规标准</Text>
                <Text style={styles.infoValue}>CCAR-61部</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>数据存储</Text>
                <Text style={styles.infoValue}>100% 纯本地 SQLite（离线优先）</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>总记录数</Text>
                <Text style={styles.infoValue}>{logbooks.length} 条</Text>
            </View>
        </ScrollView>
    );
};

// ─── Observable Binding ───────────────────────────────────────────────────────

const enhance = withObservables([], () => ({
    logbooks: database
        .get<LogbookRecord>('logbook_records')
        .query(Q.where('is_deleted', false))
        .observe(),
}));

export const SettingsScreen = enhance(SettingsScreenBase);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    content: { padding: 16, paddingBottom: 40 },

    sectionHeader: {
        color: COLORS.accent,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: 20,
        marginBottom: 12,
    },

    exportCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 12,
        padding: 16,
        marginBottom: 10,
    },
    exportCardDisabled: { opacity: 0.6 },
    exportIcon: { fontSize: 28, marginRight: 12 },
    exportInfo: { flex: 1 },
    exportTitle: { color: COLORS.text, fontSize: 15, fontWeight: '600', marginBottom: 4 },
    exportDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18 },
    exportCount: { color: COLORS.accent, fontSize: 11, marginTop: 4, fontWeight: '500' },
    exportArrow: { color: COLORS.textSecondary, fontSize: 20, marginLeft: 8 },

    infoCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 10,
        padding: 14,
        marginBottom: 8,
    },
    infoLabel: { color: COLORS.textSecondary, fontSize: 14 },
    infoValue: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
});

export default SettingsScreen;
