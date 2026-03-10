# ✈️ CAAC Digital Logbook（民航飞行员电子飞行经历记录本）

> 一款专为民航飞行员打造的离线优先 (Offline-First)、极简智能且严格符合 CAAC/ICAO 标准的个人专属电子飞行经历记录本。

## 🎯 核心特性

* **📴 离线优先架构**：核心数据（SQLite / WatermelonDB）完全落盘本地，机舱断网环境下拥有 100% 完整录入与导出功能。
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
│   └── TimeUtils.ts         # 纯数字时间输入格式化
├── model/
│   ├── schema.ts            # WatermelonDB schema v4
│   └── LogbookRecord.ts     # 数据模型
├── worker/
│   ├── worker.js            # Cloudflare Worker（API 瀑布流 + KV 缓存）
│   └── wrangler.toml        # Workers 部署配置
└── PRD.md                   # 产品需求文档 V1.3
```

---
*Designed & Built for Pilots. ✈️*
