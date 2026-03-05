/**
 * @file utils/supabaseClient.ts
 * @description Phase 7.2: Supabase 免费云端 SDK 初始化
 *
 * 使用步骤：
 *  1. 访问 https://supabase.com 注册免费账号
 *  2. 新建项目，在【Project Settings → API】页面获取：
 *     - Project URL  (SUPABASE_URL)
 *     - anon public  (SUPABASE_ANON_KEY)
 *  3. 将下方占位值替换为真实值
 *  4. 在 Supabase SQL Editor 中执行以下建表语句：
 *
 * ─── Supabase 建表 SQL ────────────────────────────────────────────────────────
 *
 * create table logbook_records (
 *   id              text        primary key,        -- WatermelonDB local id
 *   _status         text        not null default 'created',
 *   _changed        text        not null default '',
 *   user_id         uuid        references auth.users(id),
 *   duty_type       text        not null,
 *   flight_no       text,
 *   schd_date       text        not null,
 *   actl_date       text        not null,
 *   acft_type       text        not null,
 *   reg_no          text,
 *   dep_icao        text,
 *   arr_icao        text,
 *   off_time_utc    text        not null,
 *   to_time_utc     text,
 *   ldg_time_utc    text,
 *   on_time_utc     text        not null,
 *   block_time_min  integer     not null default 0,
 *   pic_min         integer     not null default 0,
 *   sic_min         integer     not null default 0,
 *   pic_us_min      integer              default 0,
 *   spic_min        integer              default 0,
 *   dual_min        integer     not null default 0,
 *   instructor_min  integer     not null default 0,
 *   night_flight_min integer    not null default 0,
 *   instrument_min  integer     not null default 0,
 *   pilot_role      text,
 *   approach_type   text,
 *   day_to          integer,
 *   night_to        integer,
 *   day_ldg         integer     not null default 0,
 *   night_ldg       integer     not null default 0,
 *   sim_no          text,
 *   sim_cat         text,
 *   training_agency text,
 *   training_type   text,
 *   remarks         text,
 *   uuid            text,
 *   is_deleted      boolean     not null default false,
 *   last_modified_at text       not null,
 *   sync_status     text        not null default 'LOCAL_ONLY',
 *   created_at      timestamptz not null default now(),
 *   updated_at      timestamptz not null default now()
 * );
 *
 * -- Row Level Security（强制开启，每个用户只能看自己的记录）
 * alter table logbook_records enable row level security;
 *
 * create policy "Users can CRUD their own records"
 *   on logbook_records for all
 *   using  (auth.uid() = user_id)
 *   with check (auth.uid() = user_id);
 *
 * -- 索引
 * create index on logbook_records (user_id, actl_date);
 * create index on logbook_records (user_id, last_modified_at);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

// ⚠️  替换为你在 Supabase Dashboard 获取的真实值，切勿提交 Secret Key 到公开仓库
export const SUPABASE_URL      = 'https://your-project-id.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-key';

/**
 * 判断 Supabase 是否已配置（未替换占位值则视为未配置，进入本地模式）。
 */
export const isSupabaseConfigured = (): boolean =>
    !SUPABASE_URL.includes('your-project-id') &&
    !SUPABASE_ANON_KEY.includes('your-anon-key');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
