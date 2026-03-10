/**
 * @file utils/__tests__/ImportService.test.ts
 * @description Unit tests for ImportService.
 *
 * Strategy:
 *  - generateImportTemplate(): pure SheetJS — no mocking needed
 *  - checkExistingImports(): mocked database — validates query call
 *  - importFromExcel(): mocked to return 'canceled' (user-cancel path)
 *
 * Network / file-system / native-picker paths are tested via device integration tests.
 */

import * as XLSX from 'xlsx';

// ─── Module-level mocks ──────────────────────────────────────────────────────

const mockFetchCount = jest.fn().mockResolvedValue(0);
const mockFetch = jest.fn().mockResolvedValue([]);
const mockQuery = jest.fn().mockReturnValue({ fetch: mockFetch, fetchCount: mockFetchCount });
const mockGet = jest.fn().mockReturnValue({ query: mockQuery });

jest.mock('../../database', () => ({
    database: {
        get: mockGet,
        write: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
        batch: jest.fn().mockResolvedValue(undefined),
        collections: {
            get: jest.fn().mockReturnValue({
                prepareCreate: jest.fn().mockReturnValue({}),
                query: mockQuery,
            }),
        },
    },
}));

// expo-document-picker is mocked via __mocks__/expo-document-picker.js

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
    generateImportTemplate,
    checkExistingImports,
    importFromExcel,
} from '../ImportService';

// ─────────────────────────────────────────────────────────────────────────────
// generateImportTemplate
// ─────────────────────────────────────────────────────────────────────────────

describe('generateImportTemplate', () => {
    let wb: XLSX.WorkBook;

    beforeAll(() => {
        wb = generateImportTemplate();
    });

    it('returns a workbook object', () => {
        expect(wb).toBeDefined();
        expect(wb.SheetNames).toBeInstanceOf(Array);
    });

    it('contains the sheet named "标准导入模板"', () => {
        expect(wb.SheetNames).toContain('标准导入模板');
    });

    it('sheet has the "实际日期" column in the first row (hint row)', () => {
        const sheet = wb.Sheets['标准导入模板'];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        expect(rows.length).toBeGreaterThanOrEqual(2); // hint row + sample row
        const hintRow = rows[0];
        expect(hintRow).toHaveProperty('实际日期');
    });

    it('sheet has the "Block(min)" column', () => {
        const sheet = wb.Sheets['标准导入模板'];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        const hintRow = rows[0];
        expect(hintRow).toHaveProperty('Block(min)');
    });

    it('sample row (row 2) contains valid example data for 实际日期', () => {
        const sheet = wb.Sheets['标准导入模板'];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        const sampleRow = rows[1] as Record<string, unknown>;
        expect(String(sampleRow['实际日期'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('sample row (row 2) has a Block(min) value > 0', () => {
        const sheet = wb.Sheets['标准导入模板'];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        const sampleRow = rows[1];
        expect(Number(sampleRow['Block(min)'])).toBeGreaterThan(0);
    });

    it('includes all 29 required columns', () => {
        const sheet = wb.Sheets['标准导入模板'];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
        const headers = Object.keys(rows[0] ?? {});
        const expectedCols = [
            '实际日期', '计划日期', '航空器型别', '航空器登记号', '航段/SIM', '航班号',
            'OFF(UTC)', 'TO(UTC)', 'LDG(UTC)', 'ON(UTC)',
            'Block(min)', 'PIC(min)', 'PIC U/S(min)', 'SPIC(min)', 'SIC(min)',
            '带飞(min)', '教员(min)', '夜航(min)', '仪表(min)',
            '昼间起飞', '夜间起飞', '昼间落地', '夜间落地',
            '角色', '进近方式', 'SIM等级', '训练机构', '训练类型', '备注',
        ];
        expectedCols.forEach(col => {
            expect(headers).toContain(col);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkExistingImports
// ─────────────────────────────────────────────────────────────────────────────

describe('checkExistingImports', () => {
    beforeEach(() => {
        mockFetchCount.mockReset();
    });

    it('returns 0 when there are no imported records', async () => {
        mockFetchCount.mockResolvedValue(0);
        const count = await checkExistingImports();
        expect(count).toBe(0);
    });

    it('returns the correct count when there are existing imported records', async () => {
        mockFetchCount.mockResolvedValue(42);
        const count = await checkExistingImports();
        expect(count).toBe(42);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// importFromExcel — user-cancel path
// ─────────────────────────────────────────────────────────────────────────────

describe('importFromExcel', () => {
    it('returns null when the user cancels the file picker', async () => {
        // expo-document-picker mock returns { canceled: true } by default
        const result = await importFromExcel();
        expect(result).toBeNull();
    });
});
