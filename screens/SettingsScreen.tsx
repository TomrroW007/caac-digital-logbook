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
    Platform,
} from 'react-native';

// Native-only imports: guarded by Platform.OS checks at call sites.
// On web these modules are stubs / unused — the web export path uses browser APIs.
let Print: typeof import('expo-print') | undefined;
let Sharing: typeof import('expo-sharing') | undefined;
let FileSystem: typeof import('expo-file-system') | undefined;
if (Platform.OS !== 'web') {
    Print = require('expo-print');
    Sharing = require('expo-sharing');
    FileSystem = require('expo-file-system');
}
import { Q } from '@nozbe/watermelondb';
import withObservables from '@nozbe/with-observables';
import * as XLSX from 'xlsx';

import { database } from '../database';
import type { LogbookRecord } from '../model/LogbookRecord';
import { minutesToHHMM } from '../utils/TimeCalculator';

// ─── PDF HTML Generation ───────────────────────────────────────────────────────
// Strategy: "Chunked Tables" (one independent DOM per page) to guarantee
// correct thead rendering on iOS/Android WebKit (expo-print).
// PRD §5.1: per-page 本页合计/以往累计/总计 + signature bar on EVERY page.

const ROWS_PER_PAGE = 18;

/** Running numeric totals tracked across pages. */
type PageTotals = {
    blockFlight: number; blockSim: number;
    pic: number; picUs: number; spic: number; sic: number; dual: number; instr: number;
    night: number; instrument: number;
    dayTo: number; nightTo: number;
    dayLdg: number; nightLdg: number;
};

const zeroTotals = (): PageTotals => ({
    blockFlight: 0, blockSim: 0,
    pic: 0, picUs: 0, spic: 0, sic: 0, dual: 0, instr: 0,
    night: 0, instrument: 0,
    dayTo: 0, nightTo: 0, dayLdg: 0, nightLdg: 0,
});

const addRecord = (acc: PageTotals, r: LogbookRecord): PageTotals => ({
    blockFlight: acc.blockFlight + (r.isFlight ? r.blockTimeMin : 0),
    blockSim: acc.blockSim + (r.isFlight ? 0 : r.blockTimeMin),
    pic: acc.pic + r.picMin,
    picUs: acc.picUs + r.safePicUsMin,
    spic: acc.spic + r.safeSpicMin,
    sic: acc.sic + r.sicMin,
    dual: acc.dual + r.dualMin,
    instr: acc.instr + r.instructorMin,
    night: acc.night + r.nightFlightMin,
    instrument: acc.instrument + r.instrumentMin,
    dayTo: acc.dayTo + (r.isFlight ? r.safeDayTo : 0),
    nightTo: acc.nightTo + (r.isFlight ? r.safeNightTo : 0),
    dayLdg: acc.dayLdg + (r.isFlight ? r.dayLdg : 0),
    nightLdg: acc.nightLdg + (r.isFlight ? r.nightLdg : 0),
});

/** Render a single subtotal row <tr>. Label appears in first merged col. */
const subtotalRow = (label: string, t: PageTotals) => `
    <tr class="subtotal-row">
      <td colspan="4" style="text-align:right;font-weight:bold;">${label}</td>
      <td></td>
      <td colspan="4"></td>
      <td>${t.blockFlight > 0 ? minutesToHHMM(t.blockFlight) : ''}</td>
      <td>${minutesToHHMM(t.pic)}</td>
      <td>${t.picUs > 0 ? minutesToHHMM(t.picUs) : ''}</td>
      <td>${t.spic > 0 ? minutesToHHMM(t.spic) : ''}</td>
      <td>${minutesToHHMM(t.sic)}</td>
      <td>${minutesToHHMM(t.dual)}</td>
      <td>${minutesToHHMM(t.instr)}</td>
      <td>${t.night > 0 ? minutesToHHMM(t.night) : ''}</td>
      <td>${t.instrument > 0 ? minutesToHHMM(t.instrument) : ''}</td>
      <td>${t.dayTo}/${t.dayLdg}</td>
      <td>${t.nightTo}/${t.nightLdg}</td>
      <td></td><td></td>
      <td>${t.blockSim > 0 ? minutesToHHMM(t.blockSim) : ''}</td>
      <td></td>
    </tr>`;

/** Signature bar rendered at the bottom of EVERY page per CAAC audit rules. */
const signatureBar = () => `
  <div class="sig">
    <div class="sig-box">飞行员签字 Pilot Signature ______</div>
    <div class="sig-box">教员签字 Instructor Signature ______</div>
    <div class="sig-box">审查员签字 Inspector Signature ______</div>
  </div>`;

function generateLogbookHtml(records: LogbookRecord[]): string {
    // Chunk records into pages of ROWS_PER_PAGE
    const pages: LogbookRecord[][] = [];
    for (let i = 0; i < records.length; i += ROWS_PER_PAGE) {
        pages.push(records.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]); // guard: at least one page

    // Shared table header (reused by every page's <thead>)
    const thead = `
    <thead>
      <tr>
        <th>计划日期</th><th>实际日期</th><th>航空器型别</th><th>航空器登记号</th>
        <th>航段 Route</th>
        <th>OFF UTC</th><th>TO UTC</th><th>LDG UTC</th><th>ON UTC</th>
        <th>飞行时间 Total</th><th>PIC</th><th>PIC U/S</th><th>SPIC</th><th>SIC</th><th>带飞</th><th>教员</th>
        <th>夜航</th><th>仪表</th>
        <th>昼间起降</th><th>夜间起降</th>
        <th>角色</th><th>进近方式</th>
        <th>模拟机时间 Sim</th><th>备注</th>
      </tr>
    </thead>`;

    let cumulative = zeroTotals();
    const pagesHtml = pages.map((pageRecords, pageIndex) => {
        const isLastPage = pageIndex === pages.length - 1;

        // Build data rows for this page
        const rowsHtml = pageRecords.map(r => {
            const isFlight = r.dutyType === 'FLIGHT';
            return `
    <tr>
      <td>${r.schdDate}</td>
      <td>${r.actlDate}</td>
      <td>${r.acftType}</td>
      <td>${r.regNo ?? ''}</td>
      <td>${isFlight ? (r.routeString || '—') : ''}</td>
      <td>${r.offTimeUtc ? r.offTimeUtc.slice(11, 16) : ''}</td>
      <td>${r.toTimeUtc ? r.toTimeUtc.slice(11, 16) : ''}</td>
      <td>${r.ldgTimeUtc ? r.ldgTimeUtc.slice(11, 16) : ''}</td>
      <td>${r.onTimeUtc ? r.onTimeUtc.slice(11, 16) : ''}</td>
      <td>${isFlight ? minutesToHHMM(r.blockTimeMin) : ''}</td>
      <td>${minutesToHHMM(r.picMin)}</td>
      <td>${r.safePicUsMin > 0 ? minutesToHHMM(r.safePicUsMin) : ''}</td>
      <td>${r.safeSpicMin > 0 ? minutesToHHMM(r.safeSpicMin) : ''}</td>
      <td>${minutesToHHMM(r.sicMin)}</td>
      <td>${minutesToHHMM(r.dualMin)}</td>
      <td>${minutesToHHMM(r.instructorMin)}</td>
      <td>${r.nightFlightMin > 0 ? minutesToHHMM(r.nightFlightMin) : ''}</td>
      <td>${r.instrumentMin > 0 ? minutesToHHMM(r.instrumentMin) : ''}</td>
      <td>${isFlight ? `${r.safeDayTo}/${r.dayLdg}` : ''}</td>
      <td>${isFlight ? `${r.safeNightTo}/${r.nightLdg}` : ''}</td>
      <td>${isFlight ? (r.pilotRole ?? '') : ''}</td>
      <td>${isFlight ? (r.approachType ?? '') : ''}</td>
      <td>${!isFlight ? minutesToHHMM(r.blockTimeMin) : ''}</td>
      <td>${r.exportRemarks}</td>
    </tr>`;
        }).join('');

        // Compute page-block totals and grand-running totals
        const pageTotals = pageRecords.reduce(addRecord, zeroTotals());
        const prevCumulative = cumulative;  // snapshot before this page
        cumulative = pageRecords.reduce(addRecord, prevCumulative);

        // Three subtotal rows (QA: use minutesToHHMM on all time fields)
        const subtotals = [
            subtotalRow('本页合计', pageTotals),
            subtotalRow('以往累计', prevCumulative),
            subtotalRow('总计', cumulative),
        ].join('');

        // QA: page-break only between pages, NOT after the last page
        const pageBreak = isLastPage
            ? ''
            : ' style="page-break-after: always"';

        return `
  <div class="page-container"${pageBreak}>
    <table>
      ${thead}
      <tbody>${rowsHtml}${subtotals}</tbody>
    </table>
    ${signatureBar()}
  </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <style>
    @page { size: A4 landscape; margin: 12mm 10mm; }
    body  { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #111; }
    h1    { font-size: 13pt; text-align: center; margin-bottom: 4px; }
    h2    { font-size: 9pt;  text-align: center; color: #555; margin-bottom: 8px; }
    .page-container { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th    { background: #1e3a5f; color: #fff; font-size: 7pt; padding: 3px 2px; text-align: center; border: 1px solid #999; }
    td    { padding: 2px 2px; text-align: center; border: 1px solid #ccc; font-size: 7.5pt; }
    tr:nth-child(even) { background: #f5f8ff; }
    tr.subtotal-row td { background: #e8f0fe; font-weight: bold; border-top: 2px solid #1e3a5f; }
    .sig  { margin-top: 10px; display: flex; justify-content: space-between; }
    .sig-box { border-top: 1px solid #333; width: 200px; padding-top: 4px; font-size: 8pt; color: #555; }
  </style>
</head>
<body>
  <h1>飞行记录本 PILOT LOGBOOK</h1>
  <h2>依据 CCAR-61 部 · 共 ${records.length} 条记录 · 导出时间: ${new Date().toLocaleString('zh-CN')}</h2>
  ${pagesHtml}
</body>
</html>`;
}

// ─── Excel Row Mapper ─────────────────────────────────────────────────────────

function recordsToXlsxRows(records: LogbookRecord[]) {
    return records.map(r => ({
        '计划日期': r.schdDate,
        '实际日期': r.actlDate,
        '航空器型别': r.acftType,
        '航空器登记号': r.regNo ?? '',
        '航段/SIM': r.dutyType === 'FLIGHT' ? r.routeString : (r.simNo ?? ''),
        '航班号': r.flightNo ?? '',
        'OFF(UTC)': r.offTimeUtc,
        'TO(UTC)': r.toTimeUtc ?? '',
        'LDG(UTC)': r.ldgTimeUtc ?? '',
        'ON(UTC)': r.onTimeUtc,
        'Block(min)': r.blockTimeMin,
        'PIC(min)': r.picMin,
        'PIC U/S(min)': r.safePicUsMin,
        'SPIC(min)': r.safeSpicMin,
        'SIC(min)': r.sicMin,
        '带飞(min)': r.dualMin,
        '教员(min)': r.instructorMin,
        '夜航(min)': r.nightFlightMin,
        '仪表(min)': r.instrumentMin,
        // PRD §5.3 col 13/14: keep as separate NUMERIC columns for Pivot Table use
        '昼间起飞': r.safeDayTo,    // ← Phase 5 addition
        '夜间起飞': r.safeNightTo,  // ← Phase 5 addition
        '昼间落地': r.dayLdg,
        '夜间落地': r.nightLdg,
        '角色': r.pilotRole ?? '',
        '进近方式': r.approachType ?? '',
        'SIM等级': r.simCat ?? '',
        '训练机构': r.trainingAgency ?? '',
        '训练类型': r.trainingType ?? '',
        '备注': r.exportRemarks,
        'Block(H:M)': minutesToHHMM(r.blockTimeMin),
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
        setExportingPdf(true);
        try {
            const html = generateLogbookHtml(logbooks);

            if (Platform.OS === 'web') {
                // Web: open a new window with the raw HTML, then print
                const printWindow = window.open('', '_blank');
                if (!printWindow) {
                    Alert.alert('弹窗被拦截', '请允许弹出窗口后重试。');
                    return;
                }
                printWindow.document.write(html);
                printWindow.document.close();
                printWindow.focus();
                printWindow.print();
            } else {
                // Native: expo-print → file → share sheet
                const canShare = await Sharing!.isAvailableAsync();
                if (!canShare) {
                    Alert.alert('不支持', '当前设备不支持文件分享功能。');
                    return;
                }
                const { uri } = await Print!.printToFileAsync({ html, base64: false });
                const destUri = `${FileSystem!.cacheDirectory}logbook_${Date.now()}.pdf`;
                await FileSystem!.moveAsync({ from: uri, to: destUri });
                await Sharing!.shareAsync(destUri, {
                    mimeType: 'application/pdf',
                    dialogTitle: '导出 CCAR-61 飞行记录本 PDF',
                    UTI: 'com.adobe.pdf',
                });
            }
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
        setExportingExcel(true);
        try {
            const rows = recordsToXlsxRows(logbooks);
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Logbook');

            if (Platform.OS === 'web') {
                // Web: SheetJS writeFile triggers browser download directly
                XLSX.writeFile(wb, `Logbook_${Date.now()}.xlsx`);
            } else {
                // Native: write base64 to file system, then share
                const canShare = await Sharing!.isAvailableAsync();
                if (!canShare) {
                    Alert.alert('不支持', '当前设备不支持文件分享功能。');
                    return;
                }
                const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
                const destUri = `${FileSystem!.cacheDirectory}logbook_${Date.now()}.xlsx`;
                await FileSystem!.writeAsStringAsync(destUri, b64, {
                    encoding: FileSystem!.EncodingType.Base64,
                });
                await Sharing!.shareAsync(destUri, {
                    mimeType:
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    dialogTitle: '导出飞行记录本 Excel',
                    UTI: 'com.microsoft.excel.xlsx',
                });
            }
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
                    <Text style={styles.exportTitle}>📄 导出标准 PDF 报表</Text>
                    <Text style={styles.exportDesc}>
                        符合 CCAR-61 部标准，含教员签字栏，可直接打印提交局方审查
                    </Text>
                    <Text style={styles.exportCount}>
                        {logbooks.length} 条记录 · A4 横向
                    </Text>
                </View>
                {exportingPdf
                    ? (
                        <>
                            <ActivityIndicator size="small" color={COLORS.primary} />
                            <Text style={styles.exportLoadingText}>正在生成局方标准报表...</Text>
                        </>
                    )
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
                    <Text style={styles.exportTitle}>📊 导出原始 Excel 数据</Text>
                    <Text style={styles.exportDesc}>
                        供个人数据备份与电脑端二次分析，格式兼容 WPS / Microsoft Excel
                    </Text>
                    <Text style={styles.exportCount}>
                        {logbooks.length} 条记录 · .xlsx 格式
                    </Text>
                </View>
                {exportingExcel
                    ? (
                        <>
                            <ActivityIndicator size="small" color={COLORS.success} />
                            <Text style={styles.exportLoadingText}>正在生成数据文件...</Text>
                        </>
                    )
                    : <Text style={styles.exportArrow}>›</Text>}
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>关于</Text>

            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>版本</Text>
                <Text style={styles.infoValue}>1.0.0</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>合规标准</Text>
                <Text style={styles.infoValue}>CCAR-61部</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>数据存储</Text>
                <Text style={styles.infoValue}>本地（离线优先）</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>总记录数</Text>
                <Text style={styles.infoValue}>{logbooks.length} 条</Text>
            </View>

            {/* Offline privacy disclaimer */}
            <Text style={styles.offlineDisclaimer}>
                所有飞行经历数据均存储于本设备，未同步至任何外部服务器。统计基准：以北京时间（UTC+8）自然日为起算点，回溯 90 天，仅统计 FLIGHT（真实飞行）记录，不含 SIMULATOR（模拟机）训练。
            </Text>
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

    // Loading text next to spinner while generating files
    exportLoadingText: {
        color: COLORS.textSecondary,
        fontSize: 11,
        marginLeft: 8,
    },

    // Offline privacy disclaimer (bottom of 关于 section)
    offlineDisclaimer: {
        color: COLORS.textSecondary,
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 18,
        marginTop: 16,
        marginHorizontal: 8,
        opacity: 0.7,
    },
});

export default SettingsScreen;
