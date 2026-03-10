# ✈️ CAAC Digital Logbook（民航飞行员电子飞行经历记录本）

> 一款专为民航飞行员打造的离线优先 (Offline-First)、极简智能且严格符合 CAAC/ICAO 标准的个人专属电子飞行经历记录本。

## 🎯 核心特性

* **📴 离线优先架构**：核心数据（SQLite / WatermelonDB）完全落盘本地，机舱断网环境下拥有 100% 完整录入与导出功能。
* **☁️ Supabase 双向云同步**：内置 WatermelonDB 双向同步引擎，直连免费版 Supabase 服务端。100% 支持 Row Level Security (RLS) 基于 JWT 令牌的强安全多租户数据隔离保护。
* **🧠 航班号智能填充**：输入航班号失焦后，通过 Cloudflare Worker 边缘代理 + KV 缓存查询 AirLabs / AviationStack，静默带出出发站、到达站、航空器型别、航空器登记号，秒级完成基础信息录入。
* **⚖️ CAAC/ICAO 合规**：
    * 底层统一采用 **UTC 时间戳** 存储与计算，彻底解决跨时区算错时间的痛点。
    * 系统自动计算飞行时间 (Block Time)，并严格校验 `PIC + PIC U/S + SPIC + SIC + Dual + Instructor ≤ Block Time` 的合规红线。
    * 全部术语遵循 CCAR-61 部 (AC-61-FS-2015-17R1) 及 ICAO 附件 1 官方标准。
* **📊 90 天近期飞行经历 Dashboard**：以北京时间 (UTC+8) 自然日为基准，动态回溯 90 天内起飞/着陆次数，红/黄/绿三级告警护航客运飞行资质。
* **🖨️ 双格式合规导出**：
    * **PDF**：强制横屏、局方标准列头、飞行员/教员/审查员签字栏、每页合计。
    * **Excel**：SheetJS 生成，18 列完整数据，供 PC 端二次分析。

## 🏗️ 系统架构

* **客户端**：Expo (React Native) + WatermelonDB (SQLite/JSI) + TypeScript。
* **同步后端**：Supabase (PostgreSQL + Auth)，支持完全托管的 JWT 鉴权、Row Level Security (RLS)，以及应对客户端时间篡改的服务端绝对时间触发器防雷补丁。
* **Serverless 代理**：Cloudflare Workers + KV（零成本 Free Tier），AirLabs → AviationStack 瀑布流。
* **导出引擎**：expo-print (PDF) + SheetJS (Excel)，纯客户端生成，不依赖后端。

## 📝 核心业务规则

1. **SME 红线**：API 仅允许填充 DEP/ARR/ACFT/REG，时间轴 OFF/T/O/LDG/ON 严禁 API 自动覆盖。
2. **3 秒熔断**：外部航班查询设定 3000ms AbortController 超时。超时或无网静默降级为手工录入，不弹任何报错。
3. **不覆盖原则**：已由飞行员手动填写的字段，API 返回数据不覆盖。
4. **分钟制存储**：所有时长 INTEGER 存储分钟数，展示时格式化为 HH:MM。

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npx expo start

# 运行测试 (6 suites, 214 tests)
npx jest --verbose

# 部署 Cloudflare Worker（可选）
cd worker

# Wrangler v4 KV 命令语法（若 namespace 已存在会报已存在，可直接跳过）
npx wrangler kv namespace create "FLIGHT_CACHE"
npx wrangler kv namespace create "FLIGHT_CACHE" --env staging

# 注入生产环境 Secrets
npx wrangler secret put AVIATIONSTACK_KEY --env=""
npx wrangler secret put AIRLABS_KEY --env=""

# 注入预发布环境 Secrets（不要漏）
npx wrangler secret put AVIATIONSTACK_KEY --env staging
npx wrangler secret put AIRLABS_KEY --env staging

# 部署预发布环境（release/pre-launch-deployment 分支）
npx wrangler deploy --env staging

# 部署生产环境（main 分支）
npx wrangler deploy
```

Worker 域名约定：
- Staging: `https://caac-logbook-worker-staging.<your-subdomain>.workers.dev`
- Production: `https://caac-logbook-worker.<your-subdomain>.workers.dev`

## 🔁 GitHub 持续部署（Cloudflare Pages）

本仓库已添加自动发布工作流：`.github/workflows/deploy-pages.yml`

触发规则：
- 推送到 `main` 分支时自动构建并发布 Web 站点。
- 也可在 GitHub Actions 页面手动执行 `workflow_dispatch`。

你只需在 GitHub 仓库 `Settings > Secrets and variables > Actions` 新增：
- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token（至少包含 Pages 编辑权限）。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

部署目标：
- Project Name: `caac-digital-logbook`
- Public URL: `https://caac-digital-logbook.pages.dev`

## 🗄️ Supabase 数据库与同步初始化 (Phase 7 必备)

本应用采用了企业级同步防雷方案，不仅通过前端驱动 `synchronize()`，还需要后端配合解决同步鉴权与客户端时间偏移隐患。

1. **注册创建**：访问 [Supabase](https://supabase.com) 免费注册并创建新项目。
2. **环境变量配置**：在项目前端根目录创建 `.env`（或在 `app.json`）配置中写入：

```bash
# 🟢 ANON_KEY 对前端安全，可正常随客户端分发
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# 🔴 警告：绝对不要在前端代码中放入 SERVICE_ROLE_KEY！
```

3. **数据库初始化（SQL Editor）**：进入 Supabase 后台，执行以下 SQL 脚本以建立多租户安全数据表并部署时钟防雷触发器：

```sql
create table logbook_records (
  id              text        primary key,        -- WatermelonDB local id
  _status         text        not null default 'created',
  _changed        text        not null default '',
  user_id         uuid        references auth.users(id),
  duty_type       text        not null,
  flight_no       text,
  schd_date       text        not null,
  actl_date       text        not null,
  acft_type       text        not null,
  reg_no          text,
  dep_icao        text,
  arr_icao        text,
  off_time_utc    text        not null,
  to_time_utc     text,
  ldg_time_utc    text,
  on_time_utc     text        not null,
  block_time_min  integer     not null default 0,
  pic_min         integer     not null default 0,
  sic_min         integer     not null default 0,
  pic_us_min      integer              default 0,
  spic_min        integer              default 0,
  dual_min        integer     not null default 0,
  instructor_min  integer     not null default 0,
  night_flight_min integer    not null default 0,
  instrument_min  integer     not null default 0,
  pilot_role      text,
  approach_type   text,
  day_to          integer,
  night_to        integer,
  day_ldg         integer     not null default 0,
  night_ldg       integer     not null default 0,
  sim_no          text,
  sim_cat         text,
  training_agency text,
  training_type   text,
  remarks         text,
  uuid            text,
  is_deleted      boolean     not null default false,
  last_modified_at text       not null,
  sync_status     text        not null default 'LOCAL_ONLY',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Row Level Security (RLS) 强制开启，多租户强隔离底线
alter table logbook_records enable row level security;

create policy "Users can CRUD their own records"
  on logbook_records for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 核心索引提升 90天聚合 查询性能
create index on logbook_records (user_id, actl_date);
create index on logbook_records (user_id, last_modified_at);

-- ⏱️ 致命防雷补丁：客户端时钟漂移修复
-- [问题] 飞行员跨时区时可能产生错误的 last_modified_at，导致其他设备漏拉取。
-- [方案] 通过服务端 moddatetime 触发器接管 updated_at。
create extension if not exists moddatetime schema extensions;
create trigger handle_updated_at before update on logbook_records
  for each row execute procedure moddatetime (updated_at);
```

4. **安全越权 QA 测试验证**：
执行完建表后，立刻在 SQL Editor 执行以下验证查询：
```sql
select * from logbook_records;
```
> **通过标准**：必须返回 `0` 行，且不提示任何报错。因为控制台根查询未携带任何用户的 Auth JWT token，RLS 将拦截所有未经确认的越权读取。证明您的数据隔离网已完全生效！

## 📂 项目结构

```
├── App.tsx                  # 导航入口
├── screens/                 # 4 屏页面
│   ├── DashboardScreen.tsx  # 首页 Dashboard + 90 天告警
│   ├── TimelineScreen.tsx   # 历史记录时间线
│   ├── EntryFormScreen.tsx  # 录入页容器
│   └── SettingsScreen.tsx   # 设置 & PDF/Excel 导出
├── components/EntryForm/
│   └── DualTrackForm.tsx    # FLIGHT/SIMULATOR 双轨表单 + 航班号自动填充
├── utils/
│   ├── ApiService.ts        # 航班数据 fetch（3s 超时 + 静默降级）
│   ├── ComplianceValidator.ts # CCAR-61 合规校验引擎
│   ├── FlightMath.ts        # 四点时间轴推算
│   ├── TimeCalculator.ts    # LT↔UTC 转换 + 分钟格式化
│   ├── TimeUtils.ts         # 纯数字时间输入格式化
│   ├── SyncService.ts       # WatermelonDB <-> Supabase 核心底层同步引擎
│   └── supabaseClient.ts    # Supabase 初始化客户端
├── model/
│   ├── schema.ts            # WatermelonDB schema v4
│   └── LogbookRecord.ts     # 数据模型
├── worker/
│   ├── worker.js            # Cloudflare Worker（API 瀑布流 + KV 缓存）
│   └── wrangler.toml        # Workers 部署配置
└── PRD.md                   # 产品需求文档 V1.5 完整版
```

---
*Designed & Built for Pilots. ✈️*
