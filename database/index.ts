/**
 * @file database/index.ts
 * @description TypeScript type-export stub for platform-resolved database module.
 *
 * At build time, Metro resolves imports of '../database' to:
 *   - database/index.native.ts  (iOS / Android)
 *   - database/index.web.ts     (Web / PWA)
 *
 * This file exists solely to satisfy the TypeScript language service (IDE)
 * which does not understand Metro's platform extension resolution.
 * It re-exports from the native variant as the default type reference.
 */

export { database } from './index.native';
