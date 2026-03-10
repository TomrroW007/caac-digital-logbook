/**
 * @file utils/SyncService.ts
 * @description Phase 7.2: WatermelonDB ←→ Supabase 双向云同步引擎
 *
 * 架构要点：
 *  - 使用 WatermelonDB 官方 `synchronize()` API 驱动 pull/push 流程
 *  - `_status` / `_changed` 列由 WatermelonDB 在 push 时自动注入，无需手动追踪
 *  - Row Level Security 由 Supabase 端保障；本地逻辑只需携带 user_id
 *  - 同步状态写入 database.getLocal/setLocal（无额外依赖）
 *
 * 同步状态枚举（模块内存变量存储，应用重启后重置）：
 *   'local'   — Supabase 未配置或用户未登录
 *   'syncing' — 同步进行中
 *   'synced'  — 上次同步成功（含时间戳）
 *   'error'   — 上次同步失败（含错误信息）
 */

import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { supabase, isSupabaseConfigured } from './supabaseClient';

// ─── 同步状态类型 ─────────────────────────────────────────────────────────────

export type SyncStatus =
    | { state: 'local' }
    | { state: 'syncing' }
    | { state: 'synced'; at: number }
    | { state: 'error'; message: string };

// ─── 模块内存同步状态（规避 WatermelonDB TypeScript 类型缺失） ───────────────
// 注：应用重启后状态重置，符合 Phase 7.2 MVP 场景预期

let _currentSyncStatus: SyncStatus = { state: 'local' };

// ─── 读写同步状态 ─────────────────────────────────────────────────────────────

/**
 * 读取当前同步状态。
 * 未连接 Supabase 时返回 `{ state: 'local' }`。
 */
export const readSyncStatus = async (): Promise<SyncStatus> => {
    if (!isSupabaseConfigured()) return { state: 'local' };
    return _currentSyncStatus;
};

const writeSyncStatus = (status: SyncStatus): void => {
    _currentSyncStatus = status;
};

// ─── 主同步函数 ───────────────────────────────────────────────────────────────

/**
 * 执行一次完整的双向同步：本地变更推送到 Supabase，Supabase 最新数据拉回本地。
 *
 * @returns 同步结果状态，调用方可用于刷新 UI。
 * @throws  不抛出，所有错误均封装为 `{ state: 'error' }` 返回。
 */
export const syncWithCloud = async (): Promise<SyncStatus> => {
    if (!isSupabaseConfigured()) {
        return { state: 'local' };
    }

    // ── 鉴权：检查当前用户 ──
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
        const msg = authErr?.message ?? '用户未登录，请先在 Supabase Auth 完成认证';
        const status: SyncStatus = { state: 'error', message: msg };
        writeSyncStatus(status);
        return status;
    }
    const userId = user.id;

    // 标记同步中
    writeSyncStatus({ state: 'syncing' });

    try {
        await synchronize({
            database,

            // ── Pull：拉取 Supabase 端变更到本地 ──────────────────────────────
            pullChanges: async ({ lastPulledAt }) => {
                const sinceIso = lastPulledAt
                    ? new Date(lastPulledAt).toISOString()
                    : new Date(0).toISOString(); // 首次同步：从纪元起拉全量

                const { data, error } = await supabase
                    .from('logbook_records')
                    .select('*')
                    .eq('user_id', userId)
                    // 使用服务端 updated_at（moddatetime 触发器控制，防时钟漂移 PRD §24）
                    // gte（大于等于）避免精确边界漏拉取
                    .gte('updated_at', sinceIso);

                if (error) throw new Error(`Pull 失败：${error.message}`);

                const rows = data ?? [];
                // 按 is_deleted 分流到 deleted / updated
                const deleted = rows
                    .filter(r => r.is_deleted)
                    .map(r => r.id as string);
                const updated = rows.filter(r => !r.is_deleted);

                return {
                    changes: {
                        logbook_records: {
                            created: [],    // 均以 updated 处理，WatermelonDB 会做 upsert
                            updated,
                            deleted,
                        },
                    },
                    timestamp: Date.now(),
                };
            },

            // ── Push：将本地变更推送到 Supabase ──────────────────────────────
            pushChanges: async ({ changes }) => {
                const { logbook_records } = changes;
                if (!logbook_records) return;

                const { created = [], updated = [], deleted = [] } = logbook_records;

                // 合并 created + updated → upsert（Supabase 端以 id 为主键）
                const upsertRows = [...created, ...updated].map(r => ({
                    ...r,
                    user_id: userId,
                    // 确保 last_modified_at 总是字符串
                    last_modified_at: r.last_modified_at ?? new Date().toISOString(),
                }));

                if (upsertRows.length > 0) {
                    const { error } = await supabase
                        .from('logbook_records')
                        .upsert(upsertRows, { onConflict: 'id' });
                    if (error) throw new Error(`Push（upsert）失败：${error.message}`);
                }

                // 软删除：将 is_deleted 置为 true（不物理删除，保留审计轨迹）
                if (deleted.length > 0) {
                    const { error } = await supabase
                        .from('logbook_records')
                        .update({
                            is_deleted: true,
                            last_modified_at: new Date().toISOString(),
                        })
                        .eq('user_id', userId)
                        .in('id', deleted);
                    if (error) throw new Error(`Push（soft-delete）失败：${error.message}`);
                }
            },
        });

        const synced: SyncStatus = { state: 'synced', at: Date.now() };
        writeSyncStatus(synced);
        return synced;

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SyncService] 同步失败:', message);
        const errStatus: SyncStatus = { state: 'error', message };
        writeSyncStatus(errStatus);
        return errStatus;
    }
};

// ─── Auth State Subscription ──────────────────────────────────────────────────

/**
 * 订阅 Supabase 鉴权状态变化。
 *
 * - 用户登出时自动将同步状态重置为 `{ state: 'local' }`。
 * - 回调接收最新的 Session（或 null 表示已退出）。
 * - 返回取消订阅函数，组件卸载时调用。
 *
 * @example
 * useEffect(() => {
 *   const unsubscribe = subscribeToAuthChanges(session => setSession(session));
 *   return unsubscribe;
 * }, []);
 */
export const subscribeToAuthChanges = (
    onAuthChange: (session: import('@supabase/supabase-js').Session | null) => void,
): (() => void) => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
            writeSyncStatus({ state: 'local' });
        }
        onAuthChange(session);
    });
    return () => data.subscription.unsubscribe();
};
