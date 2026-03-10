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

// ─── Flight PDF: totals type & helpers ───────────────────────────────────────

type FlightPageTotals = {
    block: number;
    pic: number; picUs: number; spic: number; sic: number; dual: number; instr: number;
    night: number; instrument: number;
    dayTo: number; nightTo: number; dayLdg: number; nightLdg: number;
};

const zeroFlightTotals = (): FlightPageTotals => ({
    block: 0, pic: 0, picUs: 0, spic: 0, sic: 0, dual: 0, instr: 0,
    night: 0, instrument: 0, dayTo: 0, nightTo: 0, dayLdg: 0, nightLdg: 0,
});

const addFlightRecord = (acc: FlightPageTotals, r: LogbookRecord): FlightPageTotals => ({
    block: acc.block + r.blockTimeMin,
    pic: acc.pic + r.picMin,
    picUs: acc.picUs + r.safePicUsMin,
    spic: acc.spic + r.safeSpicMin,
    sic: acc.sic + r.sicMin,
    dual: acc.dual + r.dualMin,
    instr: acc.instr + r.instructorMin,
    night: acc.night + r.nightFlightMin,
    instrument: acc.instrument + r.instrumentMin,
    dayTo: acc.dayTo + r.safeDayTo,
    nightTo: acc.nightTo + r.safeNightTo,
    dayLdg: acc.dayLdg + r.dayLdg,
    nightLdg: acc.nightLdg + r.nightLdg,
});

// Flight: 24 data columns — colspan=5 covers date(2)+flightNo+acftType+regNo
const flightSubtotalRow = (label: string, t: FlightPageTotals) => `
    <tr class="subtotal-row">
      <td colspan="5" style="text-align:right;font-weight:bold;">${label}</td>
      <td colspan="4"></td>
      <td>${minutesToHHMM(t.block)}</td>
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
      <td></td><td></td><td></td>
    </tr>`;

// ─── SIM PDF: totals type & helpers ──────────────────────────────────────────

type SimPageTotals = { block: number; dual: number; instr: number };

const zeroSimTotals = (): SimPageTotals => ({ block: 0, dual: 0, instr: 0 });

const addSimRecord = (acc: SimPageTotals, r: LogbookRecord): SimPageTotals => ({
    block: acc.block + r.blockTimeMin,
    dual: acc.dual + r.dualMin,
    instr: acc.instr + r.instructorMin,
});

// SIM: 13 columns — colspan=7 covers date(2)+acftType+simNo+simCat+agency+type
const simSubtotalRow = (label: string, t: SimPageTotals) => `
    <tr class="subtotal-row">
      <td colspan="7" style="text-align:right;font-weight:bold;">${label}</td>
      <td colspan="2"></td>
      <td>${minutesToHHMM(t.block)}</td>
      <td>${minutesToHHMM(t.dual)}</td>
      <td>${minutesToHHMM(t.instr)}</td>
      <td></td>
    </tr>`;

/** Signature bar rendered at the bottom of EVERY page per CAAC audit rules. */
const signatureBar = () => `
  <div class="sig">
    <div class="sig-box">飞行员签字 Pilot Signature ______</div>
    <div class="sig-box">教员签字 Instructor Signature ______</div>
    <div class="sig-box">审查员签字 Inspector Signature ______</div>
  </div>`;

// ─── PDF Generator: 真实飞行（24列）─────────────────────────────────────────

function generateFlightHtml(records: LogbookRecord[], timezone: 'LT_BEIJING' | 'UTC'): string {
    const tz = timezone === 'LT_BEIJING' ? 'LT' : 'UTC';
    const pages: LogbookRecord[][] = [];
    for (let i = 0; i < records.length; i += ROWS_PER_PAGE) {
        pages.push(records.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    const thead = `
    <thead>
      <tr>
        <th>计划日期</th><th>实际日期</th><th>航班号</th><th>机型</th><th>登记号</th>
        <th>航段 Route</th>
        <th>OFF(${tz})</th><th>TO(${tz})</th><th>LDG(${tz})</th><th>ON(${tz})</th>
        <th>Block</th><th>PIC</th><th>PIC U/S</th><th>SPIC</th><th>SIC</th><th>带飞</th><th>教员</th>
        <th>夜航</th><th>仪表</th>
        <th>昼间起降</th><th>夜间起降</th>
        <th>角色</th><th>进近方式</th><th>备注</th>
      </tr>
    </thead>`;

    let cumulative = zeroFlightTotals();
    return pages.map((pageRecords, pageIndex) => {
        const isLastPage = pageIndex === pages.length - 1;
        const rowsHtml = pageRecords.map(r => `
    <tr>
      <td>${r.schdDate}</td>
      <td>${r.actlDate}</td>
      <td>${r.flightNo ?? ''}</td>
      <td>${r.acftType}</td>
      <td>${r.regNo ?? ''}</td>
      <td>${r.routeString || '—'}</td>
      <td>${fmtTime(r.offTimeUtc, timezone)}</td>
      <td>${fmtTime(r.toTimeUtc, timezone)}</td>
      <td>${fmtTime(r.ldgTimeUtc, timezone)}</td>
      <td>${fmtTime(r.onTimeUtc, timezone)}</td>
      <td>${minutesToHHMM(r.blockTimeMin)}</td>
      <td>${minutesToHHMM(r.picMin)}</td>
      <td>${r.safePicUsMin > 0 ? minutesToHHMM(r.safePicUsMin) : ''}</td>
      <td>${r.safeSpicMin > 0 ? minutesToHHMM(r.safeSpicMin) : ''}</td>
      <td>${minutesToHHMM(r.sicMin)}</td>
      <td>${minutesToHHMM(r.dualMin)}</td>
      <td>${minutesToHHMM(r.instructorMin)}</td>
      <td>${r.nightFlightMin > 0 ? minutesToHHMM(r.nightFlightMin) : ''}</td>
      <td>${r.instrumentMin > 0 ? minutesToHHMM(r.instrumentMin) : ''}</td>
      <td>${r.safeDayTo}/${r.dayLdg}</td>
      <td>${r.safeNightTo}/${r.nightLdg}</td>
      <td>${r.pilotRole ?? ''}</td>
      <td>${r.approachType ?? ''}</td>
      <td>${r.exportRemarks}</td>
    </tr>`).join('');

        const pageTotals = pageRecords.reduce(addFlightRecord, zeroFlightTotals());
        const prevCumulative = cumulative;
        cumulative = pageRecords.reduce(addFlightRecord, prevCumulative);
        const subtotals = [
            flightSubtotalRow('本页合计', pageTotals),
            flightSubtotalRow('以往累计', prevCumulative),
            flightSubtotalRow('总计', cumulative),
        ].join('');
        const pageBreak = isLastPage ? '' : ' style="page-break-after: always"';
        return `
  <div class="page-container"${pageBreak}>
    <table>${thead}<tbody>${rowsHtml}${subtotals}</tbody></table>
    ${signatureBar()}
  </div>`;
    }).join('\n');
}

// ─── PDF Generator: 模拟机（13列）────────────────────────────────────────────

function generateSimHtml(records: LogbookRecord[]): string {
    const pages: LogbookRecord[][] = [];
    for (let i = 0; i < records.length; i += ROWS_PER_PAGE) {
        pages.push(records.slice(i, i + ROWS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    const thead = `
    <thead>
      <tr>
        <th>计划日期</th><th>实际日期</th><th>机型</th><th>SIM编号</th><th>SIM等级</th>
        <th>训练机构</th><th>训练类型</th>
        <th>FROM(LT)</th><th>TO(LT)</th>
        <th>SIM时间</th><th>带飞</th><th>教员</th><th>备注</th>
      </tr>
    </thead>`;

    let cumulative = zeroSimTotals();
    return pages.map((pageRecords, pageIndex) => {
        const isLastPage = pageIndex === pages.length - 1;
        const rowsHtml = pageRecords.map(r => `
    <tr>
      <td>${r.schdDate}</td>
      <td>${r.actlDate}</td>
      <td>${r.acftType}</td>
      <td>${r.simNo ?? ''}</td>
      <td>${r.simCat ?? ''}</td>
      <td>${r.trainingAgency ?? ''}</td>
      <td>${r.trainingType ?? ''}</td>
      <td>${fmtTime(r.offTimeUtc, 'LT_BEIJING')}</td>
      <td>${fmtTime(r.onTimeUtc, 'LT_BEIJING')}</td>
      <td>${minutesToHHMM(r.blockTimeMin)}</td>
      <td>${minutesToHHMM(r.dualMin)}</td>
      <td>${minutesToHHMM(r.instructorMin)}</td>
      <td>${r.exportRemarks}</td>
    </tr>`).join('');

        const pageTotals = pageRecords.reduce(addSimRecord, zeroSimTotals());
        const prevCumulative = cumulative;
        cumulative = pageRecords.reduce(addSimRecord, prevCumulative);
        const subtotals = [
            simSubtotalRow('本页合计', pageTotals),
            simSubtotalRow('以往累计', prevCumulative),
            simSubtotalRow('总计', cumulative),
        ].join('');
        const pageBreak = isLastPage ? '' : ' style="page-break-after: always"';
        return `
  <div class="page-container"${pageBreak}>
    <table>${thead}<tbody>${rowsHtml}${subtotals}</tbody></table>
    ${signatureBar()}
  </div>`;
    }).join('\n');
}

// ─── PDF Wrapper: combine flight / SIM / both sections ────────────────────────

function buildExportHtml(
    flightRecords: LogbookRecord[],
    simRecords: LogbookRecord[],
    exportType: 'ALL' | 'FLIGHT' | 'SIMULATOR',
    timezone: 'LT_BEIJING' | 'UTC',
): string {
    const totalCount = flightRecords.length + simRecords.length;
    let sections = '';

    if (exportType === 'FLIGHT' || exportType === 'ALL') {
        sections += `<h2 class="chapter">✈ 真实飞行记录 · ${flightRecords.length} 条</h2>`;
        sections += generateFlightHtml(flightRecords, timezone);
    }
    if (exportType === 'SIMULATOR' || exportType === 'ALL') {
        if (exportType === 'ALL' && flightRecords.length > 0) {
            sections += '<div style="page-break-after: always"></div>';
        }
        sections += `<h2 class="chapter">🖥 模拟机训练记录 · ${simRecords.length} 条</h2>`;
        sections += generateSimHtml(simRecords);
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <style>
    @page { size: A4 landscape; margin: 12mm 10mm; }
    body  { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #111; }
    h1    { font-size: 13pt; text-align: center; margin-bottom: 4px; }
    h2    { font-size: 9pt;  text-align: center; color: #555; margin-bottom: 8px; }
    h2.chapter { font-size: 11pt; color: #1e3a5f; border-bottom: 2px solid #1e3a5f; padding-bottom: 4px; margin: 16px 0 8px; }
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
  <h2>依据 CCAR-61 部 · 共 ${totalCount} 条记录 · 导出时间: ${new Date().toLocaleString('zh-CN')}</h2>
  ${sections}
</body>
</html>`;
}

// ─── Time Formatter ───────────────────────────────────────────────────────────

/**
 * Format a UTC ISO time string for display.
 * LT_BEIJING: apply +8h offset using getUTC* to stay device-timezone-independent.
 * UTC: extract raw UTC hours/minutes.
 */
function fmtTime(utcIso: string | null | undefined, timezone: 'LT_BEIJING' | 'UTC'): string {
    if (!utcIso) return '';
    const d = new Date(utcIso);
    if (isNaN(d.getTime())) return '';
    if (timezone === 'LT_BEIJING') {
        const lt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
        const h = String(lt.getUTCHours()).padStart(2, '0');
        const m = String(lt.getUTCMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    }
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

// ─── Export Data Preparer ─────────────────────────────────────────────────────

/**
 * Filter logbook records by record type for export.
 * 'ALL'       → return all records
 * 'FLIGHT'    → only dutyType === 'FLIGHT'
 * 'SIMULATOR' → only dutyType === 'SIMULATOR'
 */
function prepareExportData(
    records: LogbookRecord[],
    recordType: 'ALL' | 'FLIGHT' | 'SIMULATOR',
): LogbookRecord[] {
    if (recordType === 'ALL') return records;
    if (recordType === 'FLIGHT') return records.filter(r => r.dutyType === 'FLIGHT');
    return records.filter(r => r.dutyType === 'SIMULATOR');
}

// ─── Excel Row Mappers ────────────────────────────────────────────────────────

/** 真实飞行记录 → Excel 行（飞行专属23列）*/
function flightRecordsToXlsxRows(records: LogbookRecord[], timezone: 'LT_BEIJING' | 'UTC') {
    const tzLabel = timezone === 'LT_BEIJING' ? 'LT' : 'UTC';
    return records.map(r => ({
        '计划日期': r.schdDate,
        '实际日期': r.actlDate,
        '航班号': r.flightNo ?? '',
        '机型': r.acftType,
        '登记号': r.regNo ?? '',
        '航段': r.routeString ?? '',
        [`OFF(${tzLabel})`]: fmtTime(r.offTimeUtc, timezone),
        [`TO(${tzLabel})`]: fmtTime(r.toTimeUtc, timezone),
        [`LDG(${tzLabel})`]: fmtTime(r.ldgTimeUtc, timezone),
        [`ON(${tzLabel})`]: fmtTime(r.onTimeUtc, timezone),
        'Block(min)': r.blockTimeMin,
        'Block(H:M)': minutesToHHMM(r.blockTimeMin),
        'PIC(min)': r.picMin,
        'PIC U/S(min)': r.safePicUsMin,
        'SPIC(min)': r.safeSpicMin,
        'SIC(min)': r.sicMin,
        '带飞(min)': r.dualMin,
        '教员(min)': r.instructorMin,
        '夜航(min)': r.nightFlightMin,
        '仪表(min)': r.instrumentMin,
        '昼间起飞': r.safeDayTo,
        '夜间起飞': r.safeNightTo,
        '昼间落地': r.dayLdg,
        '夜间落地': r.nightLdg,
        '角色': r.pilotRole ?? '',
        '进近方式': r.approachType ?? '',
        '备注': r.exportRemarks,
    }));
}

/** 模拟机记录 → Excel 行（SIM专属12列，无时区选项—SIM时刻统一为LT北京时间）*/
function simRecordsToXlsxRows(records: LogbookRecord[]) {
    return records.map(r => ({
        '计划日期': r.schdDate,
        '实际日期': r.actlDate,
        '机型': r.acftType,
        'SIM编号': r.simNo ?? '',
        'SIM等级': r.simCat ?? '',
        '训练机构': r.trainingAgency ?? '',
        '训练类型': r.trainingType ?? '',
        'FROM(LT)': fmtTime(r.offTimeUtc, 'LT_BEIJING'),
        'TO(LT)': fmtTime(r.onTimeUtc, 'LT_BEIJING'),
        'SIM时间(min)': r.blockTimeMin,
        'SIM时间(H:M)': minutesToHHMM(r.blockTimeMin),
        '带飞(min)': r.dualMin,
        '教员(min)': r.instructorMin,
        '备注': r.exportRemarks,
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
    // ── Phase 8: Export filter states ────────────────────────────────────────
    const [exportRecordType, setExportRecordType] = useState<'ALL' | 'FLIGHT' | 'SIMULATOR'>('ALL');
    const [exportTimezone, setExportTimezone] = useState<'LT_BEIJING' | 'UTC'>('LT_BEIJING');

    // ── PDF Export ──────────────────────────────────────────────────
    const handlePdfExport = async () => {
        const flightRecords = exportRecordType === 'SIMULATOR'
            ? [] : logbooks.filter(r => r.dutyType === 'FLIGHT');
        const simRecords = exportRecordType === 'FLIGHT'
            ? [] : logbooks.filter(r => r.dutyType === 'SIMULATOR');

        if (flightRecords.length === 0 && simRecords.length === 0) {
            Alert.alert('无记录', '暂无可导出的记录（请检查过滤条件）。');
            return;
        }
        setExportingPdf(true);
        try {
            const html = buildExportHtml(flightRecords, simRecords, exportRecordType, exportTimezone);

            if (Platform.OS === 'web') {
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
        const flightRecords = exportRecordType === 'SIMULATOR'
            ? [] : logbooks.filter(r => r.dutyType === 'FLIGHT');
        const simRecords = exportRecordType === 'FLIGHT'
            ? [] : logbooks.filter(r => r.dutyType === 'SIMULATOR');

        if (flightRecords.length === 0 && simRecords.length === 0) {
            Alert.alert('无记录', '暂无可导出的记录（请检查过滤条件）。');
            return;
        }
        setExportingExcel(true);
        try {
            const wb = XLSX.utils.book_new();
            // ALL → 两个 Sheet；单类型 → 对应单 Sheet
            if (flightRecords.length > 0) {
                const ws = XLSX.utils.json_to_sheet(flightRecordsToXlsxRows(flightRecords, exportTimezone));
                XLSX.utils.book_append_sheet(wb, ws, '飞行记录');
            }
            if (simRecords.length > 0) {
                const ws = XLSX.utils.json_to_sheet(simRecordsToXlsxRows(simRecords));
                XLSX.utils.book_append_sheet(wb, ws, '模拟机记录');
            }

            if (Platform.OS === 'web') {
                XLSX.writeFile(wb, `Logbook_${Date.now()}.xlsx`);
            } else {
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

            {/* ── Phase 8: Export Filter Card (Segmented Controls) ── */}
            <Text style={styles.sectionHeader}>导出设置 Export Settings</Text>
            <View style={styles.filterCard}>
                <Text style={styles.filterLabel}>记录类型 Record Type</Text>
                <View style={styles.segmentedRow}>
                    {(['ALL', 'FLIGHT', 'SIMULATOR'] as const).map(type => (
                        <TouchableOpacity
                            key={type}
                            style={[styles.segBtn, exportRecordType === type && styles.segBtnActive]}
                            onPress={() => setExportRecordType(type)}
                            testID={`filter-type-${type.toLowerCase()}`}
                        >
                            <Text style={[styles.segBtnText, exportRecordType === type && styles.segBtnTextActive]}>
                                {type === 'ALL' ? '全部' : type === 'FLIGHT' ? '真实飞行' : '模拟机'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={[styles.filterLabel, { marginTop: 12 }]}>时间标准 Timezone</Text>
                <View style={styles.segmentedRow}>
                    {(['LT_BEIJING', 'UTC'] as const).map(tz => (
                        <TouchableOpacity
                            key={tz}
                            style={[styles.segBtn, exportTimezone === tz && styles.segBtnActive]}
                            onPress={() => setExportTimezone(tz)}
                            testID={`filter-tz-${tz.toLowerCase()}`}
                        >
                            <Text style={[styles.segBtnText, exportTimezone === tz && styles.segBtnTextActive]}>
                                {tz === 'LT_BEIJING' ? '北京时间 LT' : 'UTC'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={styles.filterCount}>
                    已筛选 {prepareExportData(logbooks, exportRecordType).length} 条记录 ·
                    {exportTimezone === 'LT_BEIJING' ? ' 展示北京时间 (UTC+8)' : ' 展示 UTC 时间'}
                </Text>
            </View>

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
                        {prepareExportData(logbooks, exportRecordType).length} 条记录 · A4 横向
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
                        {prepareExportData(logbooks, exportRecordType).length} 条记录 · .xlsx 格式
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
                <Text style={styles.infoValue}>1.4.0 (Phase 8)</Text>
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

    // ── Phase 8: Export filter card & segmented controls ────────────────────────
    filterCard: {
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
    },
    filterLabel: {
        color: COLORS.textSecondary,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 8,
    },
    segmentedRow: {
        flexDirection: 'row',
        gap: 6,
    },
    segBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: COLORS.border,
        backgroundColor: COLORS.background,
    },
    segBtnActive: {
        borderColor: COLORS.primary,
        backgroundColor: '#1E3A5F',
    },
    segBtnText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
    segBtnTextActive: {
        color: '#DBEAFE',
    },
    filterCount: {
        color: COLORS.accent,
        fontSize: 11,
        marginTop: 10,
        fontWeight: '500',
        textAlign: 'center',
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
