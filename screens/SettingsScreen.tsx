/**
 * @file screens/SettingsScreen.tsx
 * @description Settings & Export screen — Phase 8: split FLIGHT/SIMULATOR PDF & Excel export
 *              with segmented-control timezone / record-type filters.
 *
 * PRD §五 + §18: Dual-format export, type-filtered, timezone-aware.
 *   - PDF: Flight (24-col, A4 landscape) and/or Simulator (13-col) sections.
 *   - Excel: separate Sheets for 飞行记录 / 模拟机记录.
 *   - Filter card: [全部|真实飞行|模拟机] × [北京时间 LT|UTC]
 *
 * Export flow (both formats):
 *   1. Query all non-deleted logbook records from WatermelonDB (via withObservables).
 *   2. Split into flight / sim arrays based on user filter.
 *   3. Generate the file in memory (split sections).
 *   4. Write to expo FileSystem temp directory.
 *   5. Call expo-sharing to hand off to the OS share sheet.
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Platform,
    Modal,
    TextInput,
    KeyboardAvoidingView,
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
import {
    importFromExcel,
    checkExistingImports,
    generateImportTemplate,
    type ImportResult,
} from '../utils/ImportService';
import { syncWithCloud } from '../utils/SyncService';
import { isSupabaseConfigured, supabase } from '../utils/supabaseClient';
import { subscribeToAuthChanges } from '../utils/SyncService';
import type { Session } from '@supabase/supabase-js';
import { crossAlert } from '../utils/alertPolyfill';

// ─── PDF HTML Generation ───────────────────────────────────────────────────────
// Strategy: "Chunked Tables" (one independent DOM per page) to guarantee
// correct thead rendering on iOS/Android WebKit (expo-print).
// PRD §5.1 + §18: per-page subtotals + signature bar; separate FLIGHT / SIM sections.

const ROWS_PER_PAGE = 18;

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

// ─── Per-type Running Totals ───────────────────────────────────────────────────

type FlightTotals = {
    block: number;
    pic: number; picUs: number; spic: number; sic: number; dual: number; instr: number;
    night: number; instrument: number;
    dayTo: number; nightTo: number; dayLdg: number; nightLdg: number;
};

const zeroFlightTotals = (): FlightTotals => ({
    block: 0, pic: 0, picUs: 0, spic: 0, sic: 0, dual: 0, instr: 0,
    night: 0, instrument: 0, dayTo: 0, nightTo: 0, dayLdg: 0, nightLdg: 0,
});

const addFlightRecord = (acc: FlightTotals, r: LogbookRecord): FlightTotals => ({
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

type SimTotals = { block: number; dual: number; instr: number; };
const zeroSimTotals = (): SimTotals => ({ block: 0, dual: 0, instr: 0 });
const addSimRecord = (acc: SimTotals, r: LogbookRecord): SimTotals => ({
    block: acc.block + r.blockTimeMin,
    dual: acc.dual + r.dualMin,
    instr: acc.instr + r.instructorMin,
});

/** Signature bar rendered at the bottom of EVERY page per CAAC audit rules. */
const signatureBar = () => `
  <div class="sig">
    <div class="sig-box">飞行员签字 Pilot Signature ______</div>
    <div class="sig-box">教员签字 Instructor Signature ______</div>
    <div class="sig-box">审查员签字 Inspector Signature ______</div>
  </div>`;

const flightSubtotalRow = (label: string, t: FlightTotals) => `
    <tr class="subtotal-row">
      <td colspan="6" style="text-align:right;font-weight:bold;">${label}</td>
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
      <td></td><td></td>
    </tr>`;

const simSubtotalRow = (label: string, t: SimTotals) => `
    <tr class="subtotal-row">
      <td colspan="7" style="text-align:right;font-weight:bold;">${label}</td>
      <td colspan="2"></td>
      <td>${minutesToHHMM(t.block)}</td>
      <td>${minutesToHHMM(t.dual)}</td>
      <td>${minutesToHHMM(t.instr)}</td>
      <td></td>
    </tr>`;

// ─── PDF Generator: 飞行（24列）────────────────────────────────────────────────

function generateFlightHtml(records: LogbookRecord[], timezone: 'LT_BEIJING' | 'UTC'): string {
    const tzLabel = timezone === 'LT_BEIJING' ? 'LT' : 'UTC';
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
        <th>OFF(${tzLabel})</th><th>TO(${tzLabel})</th><th>LDG(${tzLabel})</th><th>ON(${tzLabel})</th>
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

function generateSimHtml(records: LogbookRecord[], timezone: 'LT_BEIJING' | 'UTC'): string {
    const tzLabel = timezone === 'LT_BEIJING' ? 'LT' : 'UTC';
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
        <th>FROM(${tzLabel})</th><th>TO(${tzLabel})</th>
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
      <td>${fmtTime(r.offTimeUtc, timezone)}</td>
      <td>${fmtTime(r.onTimeUtc, timezone)}</td>
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
        sections += generateSimHtml(simRecords, timezone);
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

/** 真实飞行记录 → Excel 行（飞行专属列）*/
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

/** 模拟机记录 → Excel 行（SIM专属列，时刻随用户选择展示 UTC 或北京时间）*/
function simRecordsToXlsxRows(records: LogbookRecord[], timezone: 'LT_BEIJING' | 'UTC') {
    const tzLabel = timezone === 'LT_BEIJING' ? 'LT' : 'UTC';
    return records.map(r => ({
        '计划日期': r.schdDate,
        '实际日期': r.actlDate,
        '机型': r.acftType,
        'SIM编号': r.simNo ?? '',
        'SIM等级': r.simCat ?? '',
        '训练机构': r.trainingAgency ?? '',
        '训练类型': r.trainingType ?? '',
        [`FROM(${tzLabel})`]: fmtTime(r.offTimeUtc, timezone),
        [`TO(${tzLabel})`]: fmtTime(r.onTimeUtc, timezone),
        'SIM时间(min)': r.blockTimeMin,
        'SIM时间(H:M)': minutesToHHMM(r.blockTimeMin),
        '带飞(min)': r.dualMin,
        '教员(min)': r.instructorMin,
        '备注': r.exportRemarks,
    }));
}

// --- Legacy unified row-mapper (retained as dead code; superseded by split mappers above) ---
// The original single-sheet recordsToXlsxRows is replaced; stub left to unblock any future
// accidental references during refactor.
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
    error: '#EF4444',
};

const SettingsScreenBase: React.FC<SettingsProps> = ({ logbooks }) => {
    const [exportingPdf, setExportingPdf] = useState(false);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [importing, setImporting] = useState(false);
    const [downloadingTpl, setDownloadingTpl] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    // ── Phase 8: Export filter states ────────────────────────────────────────
    const [exportRecordType, setExportRecordType] = useState<'ALL' | 'FLIGHT' | 'SIMULATOR'>('ALL');
    const [exportTimezone, setExportTimezone] = useState<'LT_BEIJING' | 'UTC'>('LT_BEIJING');

    // ── 鉴权状态 ──────────────────────────────────────────────────────────────
    const [session, setSession] = useState<Session | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    // 订阅 Supabase 鉴权状态变化（含首次加载时恢复已有 session）
    useEffect(() => {
        if (!isSupabaseConfigured()) return;
        // 初始化：尝试拿到当前 session
        supabase.auth.getSession().then(({ data }) => setSession(data.session));
        const unsubscribe = subscribeToAuthChanges(s => setSession(s));
        return unsubscribe;
    }, []);

    // ── PDF Export ───────────────────────────────────────────────────────────
    const handlePdfExport = async () => {
        const flightRecords = exportRecordType === 'SIMULATOR'
            ? [] : logbooks.filter(r => r.dutyType === 'FLIGHT');
        const simRecords = exportRecordType === 'FLIGHT'
            ? [] : logbooks.filter(r => r.dutyType === 'SIMULATOR');

        if (flightRecords.length === 0 && simRecords.length === 0) {
            crossAlert('无记录', '暂无可导出的记录（请检查过滤条件）。');
            return;
        }
        setExportingPdf(true);
        try {
            const html = buildExportHtml(flightRecords, simRecords, exportRecordType, exportTimezone);

            if (Platform.OS === 'web') {
                // Web: open a new window with the raw HTML, then print
                const printWindow = window.open('', '_blank');
                if (!printWindow) {
                    crossAlert('弹窗被拦截', '请允许弹出窗口后重试。');
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
                    crossAlert('不支持', '当前设备不支持文件分享功能。');
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
            crossAlert('导出失败', 'PDF 生成时发生错误，请重试。');
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
            crossAlert('无记录', '暂无可导出的记录（请检查过滤条件）。');
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
                const ws = XLSX.utils.json_to_sheet(simRecordsToXlsxRows(simRecords, exportTimezone));
                XLSX.utils.book_append_sheet(wb, ws, '模拟机记录');
            }

            if (Platform.OS === 'web') {
                // Web: SheetJS writeFile triggers browser download directly
                XLSX.writeFile(wb, `Logbook_${Date.now()}.xlsx`);
            } else {
                // Native: write base64 to file system, then share
                const canShare = await Sharing!.isAvailableAsync();
                if (!canShare) {
                    crossAlert('不支持', '当前设备不支持文件分享功能。');
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
            crossAlert('导出失败', 'Excel 生成时发生错误，请重试。');
        } finally {
            setExportingExcel(false);
        }
    };

    // ── 下载标准导入模板 ──────────────────────────────────────────────────────
    const handleDownloadTemplate = async () => {
        setDownloadingTpl(true);
        try {
            const wb = generateImportTemplate();
            if (Platform.OS === 'web') {
                XLSX.writeFile(wb, 'CAAC_Logbook_Import_Template.xlsx');
            } else {
                const canShare = await Sharing!.isAvailableAsync();
                if (!canShare) {
                    crossAlert('不支持', '当前设备不支持文件分享功能。');
                    return;
                }
                const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
                const destUri = `${FileSystem!.cacheDirectory}Import_Template.xlsx`;
                await FileSystem!.writeAsStringAsync(destUri, b64, {
                    encoding: FileSystem!.EncodingType.Base64,
                });
                await Sharing!.shareAsync(destUri, {
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    dialogTitle: '下载标准导入模板',
                    UTI: 'com.microsoft.excel.xlsx',
                });
            }
        } catch (err) {
            console.error('[SettingsScreen] Template download error:', err);
            crossAlert('下载失败', '模板生成时发生错误，请重试。');
        } finally {
            setDownloadingTpl(false);
        }
    };

    // ── 导入历史记录 ─────────────────────────────────────────────────────────
    const handleImport = async () => {
        // QA：导入前检查已有导入数据，给出防重警告
        try {
            const existingCount = await checkExistingImports();
            if (existingCount > 0) {
                const shouldContinue = await new Promise<boolean>(resolve => {
                    crossAlert(
                        '⚠️ 检测到已有导入记录',
                        `数据库中已存在 ${existingCount} 条带有「[导入]」标记的历史记录。\n\n继续导入可能导致重复计算飞行时间，系统将自动跳过指纹相同的条目，但强烈建议先核查后再继续。`,
                        [
                            { text: '取消', style: 'cancel', onPress: () => resolve(false) },
                            { text: '继续导入', style: 'destructive', onPress: () => resolve(true) },
                        ],
                    );
                });
                if (!shouldContinue) return;
            }
        } catch {
            // 预检失败不阻断主流程
        }

        setImporting(true);
        try {
            const result: ImportResult | null = await importFromExcel();
            if (result === null) return; // 用户取消选择文件

            const { success, skipped, errors, total } = result;
            const lines = [
                `📋 共解析 ${total} 行`,
                `✅ 成功写入 ${success} 条`,
                skipped > 0 ? `⏭ 重复跳过 ${skipped} 条` : null,
                errors.length > 0 ? `⚠️ ${errors.length} 行有错误（已跳过）` : null,
            ].filter(Boolean).join('\n');

            crossAlert(
                success > 0 ? '导入完成' : '导入结果',
                lines,
                [{ text: '好的' }],
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : '未知错误';
            console.error('[SettingsScreen] Import error:', err);
            crossAlert('导入失败', `导入过程中发生错误：\n${msg}`);
        } finally {
            setImporting(false);
        }
    };

    // ── 云端同步 ──────────────────────────────────────────────────────────────
    const handleSignIn = async () => {
        if (!email.trim() || !password) {
            setAuthError('请输入邮箱和密码');
            return;
        }
        setAuthLoading(true);
        setAuthError(null);
        try {
            const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            if (error) {
                setAuthError(error.message);
            } else {
                setShowAuthModal(false);
                setEmail('');
                setPassword('');
            }
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignUp = async () => {
        if (!email.trim() || !password) {
            setAuthError('请输入邮箱和密码');
            return;
        }
        if (password.length < 6) {
            setAuthError('密码至少 6 位');
            return;
        }
        setAuthLoading(true);
        setAuthError(null);
        try {
            const { error } = await supabase.auth.signUp({ email: email.trim(), password });
            if (error) {
                setAuthError(error.message);
            } else {
                crossAlert(
                    '注册成功',
                    '请查收验证邮件并点击链接激活账号，然后回到此页面登录。',
                    [{ text: '知道了', onPress: () => { setShowAuthModal(false); setEmail(''); setPassword(''); } }],
                );
            }
        } finally {
            setAuthLoading(false);
        }
    };

    const handleSignOut = async () => {
        crossAlert(
            '退出登录',
            '退出后本地数据不受影响，下次登录可继续同步。',
            [
                { text: '取消', style: 'cancel' },
                {
                    text: '确认退出',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await supabase.auth.signOut();
                        } catch (err) {
                            console.error('[SettingsScreen] signOut error:', err);
                            // 即使出现网络错误，也强制清理本地 session
                        } finally {
                            // 强制重置本地 UI 状态，彻底解决“无法退出登录”的表象
                            setSession(null);
                            setSyncMsg(null);
                        }
                    },
                },
            ],
        );
    };

    const handleSync = async () => {
        if (!isSupabaseConfigured()) {
            crossAlert(
                '云同步未配置',
                '请先在 utils/supabaseClient.ts 中填入你的 Supabase Project URL 和 Anon Key，然后重新构建应用。',
                [{ text: '知道了' }],
            );
            return;
        }
        setSyncing(true);
        setSyncMsg(null);
        try {
            const status = await syncWithCloud();
            if (status.state === 'synced') {
                const atStr = new Date(status.at).toLocaleString('zh-CN');
                setSyncMsg(`✅ 同步成功 · ${atStr}`);
                crossAlert('云同步成功', `数据已安全备份至云端。\n同步时间：${atStr}`);
            } else if (status.state === 'error') {
                setSyncMsg(`❌ 同步失败`);
                crossAlert('云同步失败', status.message);
            }
        } catch (err) {
            setSyncMsg('❌ 同步异常');
            crossAlert('云同步异常', err instanceof Error ? err.message : '未知错误');
        } finally {
            setSyncing(false);
        }
    };

    const anyBusy = exportingPdf || exportingExcel || importing || downloadingTpl || syncing;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>

            {/* ── 历史数据导入 (Phase 7.1) ── */}
            <Text style={styles.sectionHeader}>Historical Data Import</Text>

            {/* 下载标准导入模板 */}
            <TouchableOpacity
                style={[styles.exportCard, downloadingTpl && styles.exportCardDisabled]}
                onPress={handleDownloadTemplate}
                disabled={anyBusy}
                testID="btn-download-template"
            >
                <Text style={styles.exportIcon}>📥</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>📥 Download Import Template</Text>
                    <Text style={styles.exportDesc}>
                        获取包含列名说明与填写示例的 .xlsx 空白模板，将历史数据粘贴后再上传
                    </Text>
                    <Text style={styles.exportCount}>格式：CCAR-61 标准 30 列模板</Text>
                </View>
                {downloadingTpl
                    ? (<><ActivityIndicator size="small" color={COLORS.accent} />
                        <Text style={styles.exportLoadingText}>生成中...</Text></>
                    )
                    : <Text style={styles.exportArrow}>›</Text>}
            </TouchableOpacity>

            {/* 导入历史记录 */}
            <TouchableOpacity
                style={[styles.exportCard, importing && styles.exportCardDisabled]}
                onPress={handleImport}
                disabled={anyBusy}
                testID="btn-import-excel"
            >
                <Text style={styles.exportIcon}>📤</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>📤 Import Historical Records</Text>
                    <Text style={styles.exportDesc}>
                        从标准模板 .xlsx 批量导入历史飞行记录，自动去重，打破迁移成本
                    </Text>
                    <Text style={styles.exportCount}>
                        支持 .xlsx / .xls · 自动跳过重复条目
                    </Text>
                </View>
                {importing
                    ? (<>
                        <ActivityIndicator size="small" color={COLORS.warning} />
                        <Text style={styles.exportLoadingText}>导入中，请勿关闭...</Text>
                    </>
                    )
                    : <Text style={styles.exportArrow}>›</Text>}
            </TouchableOpacity>

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

            {/* ── 导出选项 ── */}
            <Text style={styles.sectionHeader}>Export Options</Text>

            {/* PDF Export */}
            <TouchableOpacity
                style={[styles.exportCard, exportingPdf && styles.exportCardDisabled]}
                onPress={handlePdfExport}
                disabled={exportingPdf || exportingExcel}
                testID="btn-export-pdf"
            >
                <Text style={styles.exportIcon}>📄</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>📄 Export Standard PDF Report</Text>
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
                    <Text style={styles.exportTitle}>📊 Export Raw Excel Data</Text>
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

            {/* ── 云端同步 (Phase 7.2) ── */}
            <Text style={styles.sectionHeader}>Cloud Sync</Text>

            {/* 账号状态 / 登录入口 */}
            {isSupabaseConfigured() && (
                session ? (
                    <View style={styles.authStatusCard}>
                        <View style={styles.authStatusBadge}>
                            <Text style={styles.authStatusBadgeText}>✓</Text>
                        </View>
                        <View style={styles.authStatusInfo}>
                            <Text style={styles.authStatusTitle}>已登录 · 云同步已开启</Text>
                            <Text style={styles.authStatusEmail}>{session.user.email}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.signOutBtn}
                            onPress={handleSignOut}
                            testID="btn-sign-out"
                        >
                            <Text style={styles.signOutBtnText}>退出</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.exportCard}
                        onPress={() => { setAuthError(null); setShowAuthModal(true); }}
                        testID="btn-open-auth-modal"
                    >
                        <Text style={styles.exportIcon}>🔐</Text>
                        <View style={styles.exportInfo}>
                            <Text style={styles.exportTitle}>开启云同步 — 登录 / 注册</Text>
                            <Text style={styles.exportDesc}>
                                绑定账号后，数据将通过 Supabase 安全加密同步，RLS 保障仅限本人访问
                            </Text>
                        </View>
                        <Text style={styles.exportArrow}>›</Text>
                    </TouchableOpacity>
                )
            )}

            <TouchableOpacity
                style={[styles.exportCard, (syncing || !session) && styles.exportCardDisabled]}
                onPress={handleSync}
                disabled={anyBusy || !session}
                testID="btn-cloud-sync"
            >
                <Text style={styles.exportIcon}>☁️</Text>
                <View style={styles.exportInfo}>
                    <Text style={styles.exportTitle}>
                        ☁️ {isSupabaseConfigured() ? '立即同步到云端' : '云同步（未配置）'}
                    </Text>
                    <Text style={styles.exportDesc}>
                        {isSupabaseConfigured()
                            ? (session
                                ? '将本地数据双向同步至 Supabase 云端，彻底解决 iOS Safari 清缓存丢数据问题'
                                : '请先登录账号再执行同步')
                            : '填入 supabaseClient.ts 中的 Project URL 与 Anon Key 后即可启用'}
                    </Text>
                    {syncMsg && (
                        <Text style={[
                            styles.exportCount,
                            { color: syncMsg.startsWith('✅') ? COLORS.success : COLORS.error },
                        ]}>
                            {syncMsg}
                        </Text>
                    )}
                </View>
                {syncing
                    ? (<><ActivityIndicator size="small" color={COLORS.primary} />
                        <Text style={styles.exportLoadingText}>同步中...</Text></>
                    )
                    : <Text style={[styles.exportArrow, (!isSupabaseConfigured() || !session) && styles.disabledText]}>›</Text>}
            </TouchableOpacity>

            {/* Login / Register Modal */}
            <Modal
                visible={showAuthModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowAuthModal(false)}
            >
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.modalCard}>
                        {/* Header */}
                        <Text style={styles.modalTitle}>
                            {authMode === 'signin' ? '🔐 登录账号' : '📝 创建新账号'}
                        </Text>
                        <Text style={styles.authHint}>
                            {authMode === 'signin'
                                ? '登录后可将本地数据安全备份至云端'
                                : '注册 Supabase 免费账号，每月可安全同步数据'
                            }
                        </Text>

                        <View style={styles.authDivider} />

                        <TextInput
                            style={styles.authInput}
                            placeholder="邮箱地址"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={email}
                            onChangeText={setEmail}
                            testID="input-email"
                        />
                        <TextInput
                            style={styles.authInput}
                            placeholder="密码（至少 6 位）"
                            placeholderTextColor={COLORS.textSecondary}
                            secureTextEntry
                            value={password}
                            onChangeText={setPassword}
                            testID="input-password"
                        />

                        {authError && (
                            <View style={styles.authErrorBox}>
                                <Text style={styles.authErrorText}>⚠️ {authError}</Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={[styles.authPrimaryBtn, authLoading && styles.exportCardDisabled]}
                            onPress={authMode === 'signin' ? handleSignIn : handleSignUp}
                            disabled={authLoading}
                            testID="btn-auth-submit"
                        >
                            {authLoading
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={styles.authPrimaryBtnText}>
                                    {authMode === 'signin' ? '登 录' : '注 册'}
                                </Text>
                            }
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => { setAuthMode(m => m === 'signin' ? 'signup' : 'signin'); setAuthError(null); }}
                            testID="btn-toggle-auth-mode"
                        >
                            <Text style={styles.authToggleText}>
                                {authMode === 'signin' ? '没有账号？点此免费注册' : '已有账号？返回登录'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.modalCancelBtn}
                            onPress={() => setShowAuthModal(false)}
                            testID="btn-auth-cancel"
                        >
                            <Text style={styles.modalCancelText}>取消</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* ── 关于 ── */}
            <Text style={styles.sectionHeader}>About</Text>

            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>版本</Text>
                <Text style={styles.infoValue}>1.4.0</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>合规标准</Text>
                <Text style={styles.infoValue}>CCAR-61部</Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>数据存储</Text>
                <Text style={styles.infoValue}>
                    {isSupabaseConfigured() ? '本地 + 云端同步' : '本地（离线优先）'}
                </Text>
            </View>
            <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>总记录数</Text>
                <Text style={styles.infoValue}>{logbooks.length} 条</Text>
            </View>

            {/* Offline / Cloud privacy disclaimer */}
            <Text style={styles.offlineDisclaimer}>
                {isSupabaseConfigured()
                    ? '数据在本地设备和你的 Supabase 项目之间同步，行级安全（RLS）保障仅限本账号访问。统计基准：以北京时间（UTC+8）自然日为起算点，回溯 90 天，仅统计 FLIGHT 记录。'
                    : '所有飞行经历数据均存储于本设备，未同步至任何外部服务器。统计基准：以北京时间（UTC+8）自然日为起算点，回溯 90 天，仅统计 FLIGHT（真实飞行）记录，不含 SIMULATOR（模拟机）训练。'}
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
    filterCount: {
        color: COLORS.accent,
        fontSize: 11,
        marginTop: 10,
        fontWeight: '500',
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
        backgroundColor: '#111827',
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    segBtnActive: {
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
    },
    segBtnText: {
        color: COLORS.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
    segBtnTextActive: {
        color: '#fff',
    },
    disabledText: {
        color: COLORS.textSecondary,
        opacity: 0.4,
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

    // ── Auth / Cloud Sync styles ───────────────────────────────────────────
    authStatusCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#071810',
        borderWidth: 1.5,
        borderColor: COLORS.success,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        gap: 12,
    },
    authStatusBadge: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: COLORS.success,
        alignItems: 'center',
        justifyContent: 'center',
    },
    authStatusBadgeText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '800',
        lineHeight: 22,
    },
    authStatusInfo: { flex: 1 },
    authStatusTitle: { color: COLORS.success, fontSize: 13, fontWeight: '700' },
    authStatusEmail: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
    signOutBtn: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: COLORS.error,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    signOutBtnText: { color: COLORS.error, fontSize: 12, fontWeight: '600' },

    // Auth Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'flex-end',           // 从底部弹出（sheet 风格）
        paddingBottom: 0,
    },
    modalCard: {
        backgroundColor: '#1A2235',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 28,
        paddingBottom: 40,
        borderTopWidth: 1,
        borderTopColor: '#2D3A4F',
    },
    modalTitle: {
        color: COLORS.text,
        fontSize: 20,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 4,
    },
    authHint: {
        color: COLORS.textSecondary,
        fontSize: 13,
        textAlign: 'center',
        marginBottom: 20,
        lineHeight: 18,
    },
    authDivider: {
        height: 1,
        backgroundColor: '#2D3A4F',
        marginBottom: 20,
    },
    authInput: {
        backgroundColor: '#0E1928',
        borderWidth: 1.5,
        borderColor: '#2D3A4F',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: COLORS.text,
        fontSize: 15,
        marginBottom: 12,
    },
    authErrorBox: {
        backgroundColor: '#2A0E0E',
        borderWidth: 1,
        borderColor: COLORS.error,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
    },
    authErrorText: {
        color: COLORS.error,
        fontSize: 13,
        textAlign: 'center',
    },
    authPrimaryBtn: {
        backgroundColor: COLORS.primary,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 14,
    },
    authPrimaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
    authToggleText: {
        color: COLORS.accent,
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 20,
    },
    modalCancelBtn: { alignItems: 'center', paddingVertical: 4 },
    modalCancelText: { color: COLORS.textSecondary, fontSize: 14 },
});

export default SettingsScreen;
