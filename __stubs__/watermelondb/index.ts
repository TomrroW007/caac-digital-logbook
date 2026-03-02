/**
 * TypeScript type stubs for @nozbe/watermelondb
 * Used by `tsc --noEmit` in the standalone Phase 1 environment where the
 * native WatermelonDB package is not installed.
 * These stubs will be replaced by the real package when the Expo project
 * is initialized in Phase 2.
 */

export class Model {
    readonly id: string = '';
}

export interface ColumnSchema {
    name: string;
    type: 'string' | 'number' | 'boolean';
    isOptional?: boolean;
    isIndexed?: boolean;
}

export interface TableSchemaSpec {
    name: string;
    columns: ColumnSchema[];
}

export interface AppSchemaSpec {
    version: number;
    tables: TableSchemaSpec[];
}

export function tableSchema(spec: TableSchemaSpec): TableSchemaSpec {
    return spec;
}

export function appSchema(spec: AppSchemaSpec): AppSchemaSpec {
    return spec;
}
