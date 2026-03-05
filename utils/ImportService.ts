/**
 * @file utils/ImportService.ts
 * @description Phase 7.1: Excel 批量历史记录导入引擎
 *
 * 设计要点：
 *  - Web / Native 双端文件读取差异处理（Tech Lead 防雷）
 *  - 基于指纹（fingerprint）的幂等去重（QA 防重）
 *  - 导入前二次确认（QA 质检）
 *  - 每 1000 条分批写入，避免 UI 线程卡死（Tech Lead 性能优化）
 *  - 所有导入记录在 remarks 中打上 `[导入]` 标签（合规溯源）
 *
 * 标准模板列名（与 SettingsScreen 导出格式一致，强制用户使用模板）：
 *   实际日期 | 计划日期 | 航空器型别 | 航空器登记号 | 航段/SIM | 航班号
 *   OFF(UTC) | TO(UTC) | LDG(UTC) | ON(UTC) | Block(min)
 *   PIC(min) | PIC U/S(min) | SPIC(min) | SIC(min) | 带飞(min) | 教员(min)
 *   夜航(min) | 仪表(min) | 昼间起飞 | 夜间起飞 | 昼间落地 | 夜间落地
 *   角色 | 进近方式 | SIM等级 | 训练机构 | 训练类型 | 备注
 */

import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import { Platform } from 'react-native';
import { Q } from '@nozbe/watermelondb';

import { database } from '../database';
import { LogbookRecord } from '../model/LogbookRecord';
import type { DutyType, PilotRole } from '../model/schema';

// ─── 公共类型 ─────────────────────────────────────────────────────────────────

export type ImportResult = {
    /** 成功写入的条数 */
    success: number;
    /** 因指纹重复被跳过的条数 */
    skipped: number;
    /** 逐行错误描述（仅致命错误） */
    errors: string[];
    /** Excel 中解析到的总行数（不含表头） */
    total: number;
};

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

/**
 * 将任意值转换为修剪后的字符串，为空则返回 null。
 */
const nullableStr = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
};

/**
 * 解析整数（minutes），非法输入返回 0，负数归零。
 */
const safeInt = (v: unknown): number => {
    const n = parseInt(String(v ?? ''), 10);
    return isNaN(n) ? 0 : Math.max(0, n);
};

/**
 * 将 SheetJS 单元格值（可能是 Date 对象、ISO 字符串、Excel 序列号等）
 * 转换为 YYYY-MM-DD 字符串。
 */
const toDateString = (val: unknown): string => {
    // SheetJS 在 cellDates:true 时会返回 JS Date
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(val ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // 尝试解析，使用本地日期避免时区偏移
    if (s) {
        const dt = new Date(s);
        if (!isNaN(dt.getTime())) {
            const y = dt.getFullYear();
            const mo = String(dt.getMonth() + 1).padStart(2, '0');
            const d = String(dt.getDate()).padStart(2, '0');
            return `${y}-${mo}-${d}`;
        }
    }
    return s;
};

/**
 * 将单元格值标准化为 UTC ISO-8601 字符串。
 * 若单元格为空或无法解析，则以 fallbackDate 午夜 UTC 作为占位值。
 */
const toUtcIso = (val: unknown, fallbackDate: string): string => {
    if (val instanceof Date) return val.toISOString();
    const s = String(val ?? '').trim();
    if (!s) return `${fallbackDate}T00:00:00.000Z`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
    return `${fallbackDate}T00:00:00.000Z`;
};

/**
 * 根据 OFF 时间 + Block(min) 推算 ON 时间（用于历史数据中 ON 时间缺失的场景）。
 */
const computeOnUtc = (offUtc: string, blockMin: number): string => {
    try {
        const offMs = new Date(offUtc).getTime();
        if (!isNaN(offMs) && blockMin > 0) {
            return new Date(offMs + blockMin * 60_000).toISOString();
        }
    } catch {
        // 计算失败时回退到 offUtc
    }
    return offUtc;
};

/**
 * 根据日期 + 航段 + 航班号生成唯一指纹。
 * 格式：[导入] YYYY-MM-DD|RouteOrSim|FlightNo
 * 同时作为 remarks 中的可查询前缀，用于合规溯源。
 */
const makeFingerprint = (row: Record<string, unknown>): string => {
    const date  = String(row['实际日期'] ?? '').trim();
    const route = String(row['航段/SIM'] ?? '').trim().toUpperCase();
    const fno   = String(row['航班号']   ?? '').trim().toUpperCase();
    return `[导入] ${date}|${route}|${fno}`;
};

// ─── 每批写入的条数上限（Tech Lead：1000 条防 UI 卡死） ─────────────────────
const CHUNK_SIZE = 1_000;

// ─── 主函数：从 Excel 文件导入 ───────────────────────────────────────────────

/**
 * 打开系统文件选择器，读取 .xlsx / .xls，解析并批量写入本地数据库。
 * 返回 null 表示用户取消选择。
 * 导入前需由调用方（SettingsScreen）先执行 checkExistingImports() 弹出确认框。
 */
export const importFromExcel = async (): Promise<ImportResult | null> => {
    // ── Step 1: 打开文件选择器 ──
    const picked = await DocumentPicker.getDocumentAsync({
        type: [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            // iOS 有时会上报 application/octet-stream
            'application/octet-stream',
        ],
        copyToCacheDirectory: true,
    });

    if (picked.canceled || !picked.assets || picked.assets.length === 0) return null;

    const file = picked.assets[0];

    // ── Step 2: 读取文件内容（Tech Lead 防雷：Web 与 Native API 截然不同）──
    let workbook: XLSX.WorkBook;
    try {
        if (Platform.OS === 'web') {
            // Web：直接读 File.arrayBuffer()
            if (!file.file) throw new Error('Web File 对象不可用');
            const ab = await (file.file as File).arrayBuffer();
            workbook = XLSX.read(new Uint8Array(ab), { type: 'array', cellDates: true });
        } else {
            // Native：expo-file-system 读 Base64 → SheetJS base64 模式
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const FileSystem = require('expo-file-system');
            const b64: string = await FileSystem.readAsStringAsync(file.uri, {
                encoding: FileSystem.EncodingType.Base64,
            });
            workbook = XLSX.read(b64, { type: 'base64', cellDates: true });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: 0, skipped: 0, errors: [`文件读取失败：${msg}`], total: 0 };
    }

    // ── Step 3: 解析第一个工作表 ──
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return { success: 0, skipped: 0, errors: ['Excel 文件中没有工作表'], total: 0 };
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[sheetName],
        { defval: '' },
    );

    if (rows.length === 0) {
        return { success: 0, skipped: 0, errors: ['工作表内容为空'], total: 0 };
    }

    // ── Step 4: 加载已有指纹（跨次导入去重） ──
    // 查询所有含 [导入] 标记的 remarks 前缀，构成去重 Set
    const existingFpSet = new Set<string>();
    try {
        const imported = await database
            .get<LogbookRecord>('logbook_records')
            .query(Q.where('is_deleted', false), Q.where('remarks', Q.like('[导入]%')))
            .fetch();
        imported.forEach(r => {
            // remarks 格式：[导入] date|route|fno  （可能后跟原始备注，以空格分隔）
            const fp = r.remarks?.split('  ')[0] ?? '';
            if (fp) existingFpSet.add(fp);
        });
    } catch {
        // 查询失败时跳过跨次去重，本次仍按指纹内部去重
    }

    // ── Step 5: 逐行解析，构造 prepareCreate 列表 ──
    const importErrors: string[] = [];
    const toCreate: ReturnType<
        ReturnType<typeof database.collections.get<LogbookRecord>>['prepareCreate']
    >[] = [];
    let skipped = 0;
    // 当次导入内部去重 Set
    const sessionFpSet = new Set<string>(existingFpSet);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowLabel = `第 ${i + 2} 行`;

        // 必填：实际日期
        const actlDateRaw = row['实际日期'];
        if (!actlDateRaw && actlDateRaw !== 0) {
            importErrors.push(`${rowLabel}：缺少"实际日期"，已跳过`);
            continue;
        }
        const actlDate = toDateString(actlDateRaw);
        if (!actlDate) {
            importErrors.push(`${rowLabel}："实际日期"格式无法识别（值：${actlDateRaw}），已跳过`);
            continue;
        }

        // 指纹去重
        const fingerprint = makeFingerprint({ ...row, '实际日期': actlDate });
        if (sessionFpSet.has(fingerprint)) {
            skipped++;
            continue;
        }
        sessionFpSet.add(fingerprint);

        // 基础字段
        const schdDate = toDateString(row['计划日期']) || actlDate;
        const acftType = String(row['航空器型别'] ?? '').trim() || 'UNKNOWN';
        const routeOrSim = String(row['航段/SIM'] ?? '').trim().toUpperCase();
        const blockMin = safeInt(row['Block(min)']);
        const simCatVal = nullableStr(row['SIM等级']);

        // 判断 dutyType：有 SIM等级 → SIMULATOR；有标准四字 ICAO 航段 → FLIGHT；其余默认 FLIGHT
        const isIcaoRoute = /^[A-Z]{4}-[A-Z]{4}$/.test(routeOrSim);
        const dutyType: DutyType = simCatVal ? 'SIMULATOR' : 'FLIGHT';

        // 解析时间点
        const offUtc = toUtcIso(row['OFF(UTC)'], actlDate);
        const rawOn  = toUtcIso(row['ON(UTC)'], actlDate);
        // 如果 ON 与 OFF 相同（说明原始单元格为空）且有 Block 时间，则推算 ON
        const onUtc  = rawOn === offUtc && blockMin > 0
            ? computeOnUtc(offUtc, blockMin)
            : rawOn;

        // 角色字段：仅接受合法值
        const pilotRoleRaw = String(row['角色'] ?? '').trim().toUpperCase();
        const pilotRole: PilotRole | null =
            pilotRoleRaw === 'PF' || pilotRoleRaw === 'PM' ? (pilotRoleRaw as PilotRole) : null;

        // 拼接 remarks：指纹前缀 + 双空格分隔 + 原始备注（若有）
        const originalRemarks = nullableStr(row['备注']);
        const remarks = originalRemarks
            ? `${fingerprint}  ${originalRemarks}`
            : fingerprint;

        // 构造写入操作
        const collection = database.collections.get<LogbookRecord>('logbook_records');
        toCreate.push(
            collection.prepareCreate(record => {
                record.dutyType       = dutyType;
                record.actlDate       = actlDate;
                record.schdDate       = schdDate;
                record.acftType       = acftType;
                record.regNo          = nullableStr(row['航空器登记号']);
                record.flightNo       = nullableStr(row['航班号']);
                record.depIcao        = dutyType === 'FLIGHT' && isIcaoRoute
                    ? routeOrSim.split('-')[0] : null;
                record.arrIcao        = dutyType === 'FLIGHT' && isIcaoRoute
                    ? routeOrSim.split('-')[1] : null;
                record.simNo          = dutyType === 'SIMULATOR' ? (routeOrSim || null) : null;
                record.simCat         = simCatVal;
                record.trainingAgency = nullableStr(row['训练机构']);
                record.trainingType   = nullableStr(row['训练类型']);

                record.offTimeUtc     = offUtc;
                record.onTimeUtc      = onUtc;
                record.toTimeUtc      = dutyType === 'FLIGHT'
                    ? toUtcIso(row['TO(UTC)'],  actlDate) : null;
                record.ldgTimeUtc     = dutyType === 'FLIGHT'
                    ? toUtcIso(row['LDG(UTC)'], actlDate) : null;

                record.blockTimeMin   = blockMin;
                record.picMin         = safeInt(row['PIC(min)']);
                record.picUsMin       = safeInt(row['PIC U/S(min)']);
                record.spicMin        = safeInt(row['SPIC(min)']);
                record.sicMin         = safeInt(row['SIC(min)']);
                record.dualMin        = safeInt(row['带飞(min)']);
                record.instructorMin  = safeInt(row['教员(min)']);
                record.nightFlightMin = safeInt(row['夜航(min)']);
                record.instrumentMin  = safeInt(row['仪表(min)']);

                // 起降次数：若单元格为空则对飞行记录默认各 1
                const rawDayTo  = safeInt(row['昼间起飞']);
                const rawDayLdg = safeInt(row['昼间落地']);
                record.dayTo    = row['昼间起飞'] !== '' ? rawDayTo  : (dutyType === 'FLIGHT' ? 1 : 0);
                record.nightTo  = safeInt(row['夜间起飞']);
                record.dayLdg   = row['昼间落地'] !== '' ? rawDayLdg : (dutyType === 'FLIGHT' ? 1 : 0);
                record.nightLdg = safeInt(row['夜间落地']);

                record.pilotRole    = pilotRole;
                record.approachType = nullableStr(row['进近方式']);
                record.remarks      = remarks;

                // 云同步预留字段
                record.uuid            = null;
                record.isDeleted       = false;
                record.lastModifiedAt  = new Date().toISOString();
                record.appSyncStatus   = 'LOCAL_ONLY';
            }),
        );
    }

    // ── Step 6: 分批写入（Tech Lead：每 1000 条一个事务） ──
    for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
        const chunk = toCreate.slice(i, i + CHUNK_SIZE);
        await database.write(async () => {
            await database.batch(...chunk);
        });
    }

    return {
        success: toCreate.length,
        skipped,
        errors: importErrors,
        total: rows.length,
    };
};

// ─── QA: 导入前检查已有导入记录数量 ──────────────────────────────────────────

/**
 * 查询数据库中已有 `[导入]` 标记的记录数量。
 * 调用方（SettingsScreen）应在启动导入流程前调用此函数，若返回值 > 0 则弹出警告。
 */
export const checkExistingImports = async (): Promise<number> => {
    return database
        .get<LogbookRecord>('logbook_records')
        .query(Q.where('is_deleted', false), Q.where('remarks', Q.like('[导入]%')))
        .fetchCount();
};

// ─── 生成标准导入模板 ─────────────────────────────────────────────────────────

/**
 * 生成一份空白的标准导入模板 .xlsx 并触发下载（仅 Web）或 Native 分享。
 * 包含：第 1 行（列名说明）、第 2 行（示例数据）。
 *
 * 在 Native 端，需要调用方传入 FileSystem 和 Sharing 实例（避免顶层 require）。
 */
export const generateImportTemplate = (): XLSX.WorkBook => {
    // 说明行：列名 → 填写规范提示
    const hintRow: Record<string, string> = {
        '实际日期':      '✅ 必填 YYYY-MM-DD，如 2024-01-15',
        '计划日期':      '可与实际日期相同',
        '航空器型别':    '✅ 必填 如 A320 / B737',
        '航空器登记号':  '选填 如 B-6712  模拟机可填设备号',
        '航段/SIM':      '飞行填 ZBAA-ZSSS；模拟机填设备号或留空',
        '航班号':        '选填 如 CA1501',
        'OFF(UTC)':       '如 2024-01-15T06:30:00.000Z  可近似填写',
        'TO(UTC)':        '飞行必填；模拟机留空',
        'LDG(UTC)':       '飞行必填；模拟机留空',
        'ON(UTC)':        '如缺失将从 Block(min) 自动推算',
        'Block(min)':     '✅ 必填 整数分钟，如 90',
        'PIC(min)':       '整数分钟',
        'PIC U/S(min)':   '整数分钟',
        'SPIC(min)':      '整数分钟',
        'SIC(min)':       '整数分钟',
        '带飞(min)':      '整数分钟',
        '教员(min)':      '整数分钟',
        '夜航(min)':      '整数分钟',
        '仪表(min)':      '整数分钟',
        '昼间起飞':       '整数，留空则飞行记录默认 1',
        '夜间起飞':       '整数',
        '昼间落地':       '整数，留空则飞行记录默认 1',
        '夜间落地':       '整数',
        '角色':           'PF 或 PM',
        '进近方式':       '如 ILS / VOR / RNAV',
        'SIM等级':        '仅模拟机填写，如 FFS Level D',
        '训练机构':       '仅模拟机填写',
        '训练类型':       '如 OPC / PC / IR  仅模拟机',
        '备注':           '自由文本',
    };

    // 示例数据行
    const sampleRow: Record<string, string | number> = {
        '实际日期':      '2024-01-15',
        '计划日期':      '2024-01-15',
        '航空器型别':    'A320',
        '航空器登记号':  'B-6712',
        '航段/SIM':      'ZBAA-ZSSS',
        '航班号':        'CA1501',
        'OFF(UTC)':       '2024-01-15T06:30:00.000Z',
        'TO(UTC)':        '2024-01-15T06:45:00.000Z',
        'LDG(UTC)':       '2024-01-15T08:30:00.000Z',
        'ON(UTC)':        '2024-01-15T08:45:00.000Z',
        'Block(min)':     135,
        'PIC(min)':       135,
        'PIC U/S(min)':   0,
        'SPIC(min)':      0,
        'SIC(min)':       0,
        '带飞(min)':      0,
        '教员(min)':      0,
        '夜航(min)':      0,
        '仪表(min)':      30,
        '昼间起飞':       1,
        '夜间起飞':       0,
        '昼间落地':       1,
        '夜间落地':       0,
        '角色':           'PF',
        '进近方式':       'ILS',
        'SIM等级':        '',
        '训练机构':       '',
        '训练类型':       '',
        '备注':           '',
    };

    const ws = XLSX.utils.json_to_sheet([hintRow, sampleRow]);
    // 设置第 1 列宽（日期列需要足够宽）
    ws['!cols'] = Object.keys(hintRow).map(k => ({ wch: Math.max(14, k.length * 2 + 4) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '标准导入模板');
    return wb;
};
