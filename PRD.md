
# ✈️ 民航飞行员专属 LOGBOOK 产品需求文档 (PRD) V1.5 完整版

**文档状态**：已冻结 (Frozen) - V1.5 包含 Phase 7 Supabase 双向云同步与 Phase 8 重构实施细节
**目标受众**：全栈独立开发者 (Solo Developer)  
**合规基准**：严格遵循 CCAR-61部、CCAR-121部 及 ICAO 附件1  
**核心原则**：双向云同步、离线绝对优先、全量 LT 极简录入、分钟制整数存储、动态双轨表单、双格式合规导出

### 📝 V1.5 Phase 7 更新记录 (Supabase 双向云同步闭环)

22. **双向云端同步落盘**：引入 Supabase PostgreSQL + Auth 作为云端支撑，结合 WatermelonDB 官方 `synchronize()` API，实现 100% 同步闭环。
23. **军工级多租户隔离**：通过 Supabase 的 Row Level Security (RLS)，在数据库物理引擎层面通过 `auth.uid() = user_id` 进行强隔离。
24. **时钟漂移防雷**：针对 `pullChanges` 强依赖时间戳问题，采用服务端 PostgreSQL 的 `moddatetime` 扩展强制接管 `updated_at` 触发器，彻底消除客户端系统时钟错误乱导致的数据漏拉取问题。

### 📝 V1.4 Phase 8 更新记录 (极速录入 & 多维导出重构)


14. **航班号提权到第一行**：将 航班号 (Flt No.) 移至基本信息卡片首行，与实际日期 (Actl Date) 并排。确保 API 自动填充在表单最早阶段被触发。
15. **时刻与运行数据卡片合并**：将原「时刻（当地时间 LT）」、「起飞/着陆次数」、「特殊时间 Special Times」三个独立卡片合并为单一「时刻与运行数据 Time & Operations」卡片。
16. **空中时间 (Air Time) 自动推算**：时刻失焦后复用 `calcFlightTimeMin(toUtcISO, ldgUtcISO)` 引擎计算空中时间，与 Block Time 并列显示。TO/LDG 任一则显示 --:--。
17. **PF/PM 起落自动联动**：搏操角色选择 PF 后，系统依据 `isNightHintTime(LDG/ON)` 自动推算并写入 1 次昼间或夜间起落；选择 PM 则起落次数全非零。代码实现层 `isManualLandings` 开关允许手动覆盖，关闭手动模式后自动重置。**作用域限制：仅在 FLIGHT 模式下生效，不涉及 SIMULATOR。**
18. **导出记录类型过滤**：Settings 页面新安 分段控制器，允许按 [ 全部 ] [ 真实飞行 ] [ 模拟机 ] 三种类型过滤导出。
19. **导出时区报表**：支持 [ 北京时间 LT (UTC+8) ] 和 [ UTC ] 两种时标导出。LT_BEIJING 采用 `getTime() + 8*3600*1000` + `getUTCHours()` 方案，噀擦设备本地时区干扰，永远与设备所在地区无关。PDF 表鍏头动态展示 LT/UTC 标期。
20. **全站选项组件 UI 规范约定**：全站所有的选项组件（包括机型、进近方式、PF/PM 角色）统一废弃横向滚动，采用 `flexWrap: 'wrap'` 的自适应流式布局，以彻底解决 Web PWA 端横向滚动体验差的问题。对于选项数量 `> 10` 的复杂枚举（如机型），**强制要求采用“分类 Tabs + `flexWrap` 动态渲染”的结构**，严防单一列表将首屏竖向占满（Wall of Buttons）。
21. **版本升级**：应用版本号升级至 1.4.0 (Phase 8)。

### 📝 V1.3 Phase 6 更新记录 (Cloud Proxy & Auto-fill)

10. **零成本 Serverless 架构**：采用 Cloudflare Workers + KV 替代传统 Node.js + Redis 方案，实现零服务器月租、免备案的 API 代理层。
11. **航班号智能填充**：航班号失焦后自动查询 AirLabs/AviationStack API，静默填充 DEP/ARR/ACFT/REG 四个字段。
12. **SME 业务红线**：时间轴 OFF/T\/O/LDG/ON 严禁 API 自动覆盖；已填字段不覆盖（用户修改优先）。
13. **优雅降级**：3 秒 AbortController 强制熔断，超时/无网静默失败，不弹任何报错弹窗。

### 📝 V1.2 术语审阅修订记录 (Terminology Audit)

> 依据 CCAR-61 部（AC-61-FS-2015-17R1 飞行经历记录本标准格式及填写要求）、CCAR-121 部及 ICAO 附件 1 官方表述，对全项目中英文航空术语进行专家级审阅修订，共 33 项修正。

4.  **术语正字**：“撤轮挡”→“撤轮档”、“挡轮挡”→“挡轮档”（“档”为名词用木字旁）。
5.  **角色术语纠正**：“操作驾驶员”→“操纵驾驶员 (PF)”；“机长受监视”→“监视下履行机长职责 (PIC U/S)”。
6.  **局方列头对齐**：“注册号”→“航空器登记号”；“进近类型”→“进近方式”；“审查人”→“审查员”。
7.  **时间轴标签**：录入表单 MaskedTimeInput 标签从 ACARS 术语 OUT/IN 统一为 CCAR-61 标准 OFF/ON。
8.  **统一用语**：“总时长”→“飞行时间 (Block Time)”；“近期经历”→“近期飞行经历”；“看板”→“Dashboard”。
9.  **Schema 升级**：PRD 数据字典同步 schema v4 新增字段 `pic_us_min`、`spic_min`；pilot_role 拆分为 PF/PM 操纵角色 + CapacityRole 座位角色。

### 📝 V1.1 专家审阅修订记录 (Changelog)

1.  **合规修正**：将“起降”拆分为“起飞(T/O)”与“着陆(LDG)”，满足 CCAR-61 近期飞行经历 3次起飞+3次全停着陆的独立审计要求。
    
2.  **时区防雷**：增加非大陆机场的夏令时(DST)手动覆写机制；明确 90 天 Dashboard 统一按 **北京时间(UTC+8)** 计算自然日零点，防止跨时区红黄牌横跳。
    
3.  **交互增强**：强制 ICAO/机型 等字段大写且关闭自动纠错；增加夜航时间漏填的 UI 智能弱提示；备注支持一键追加 PIC U/S 标签。

## 一、 产品概述 (Product Overview)

### 1.1 背景与痛点

传统纸质飞行经历记录本存在携带不便、跨时区计算易错、90天近期飞行经历难以实时监控等痛点。市面现有工具缺乏对 CAAC (CCAR-61部) 精细化填报、夏令时自适应及教员实地签字场景的本土化支持。同时，纯单机记录一旦设备丢失极易造成毁灭性数据损失。

### 1.2 产品战略 (V1.5 范围)

打造一款专业供飞行员个人使用的电子 LOGBOOK。 **V1.5 核心战略**：**“离线体验优先 + Supabase 强隔离安全同步闭环 + 局方标准双规导出”**。通过纯数字免冒号输入、带 DST 感知的离线时区计算，实现秒级合规录入，并直接输出可供局方盖章的标准化打印件，最终通过后台静默的军工级云端同步，保障数据零丢失。

## 二、 系统架构设计 (System Architecture)

**核心架构规范**：

1.  **离线优先 (Offline-First)**：所有操作 100% 读写本地 SQLite (通过 WatermelonDB 驱动，启用 JSI 加速)。
    
2.  **分钟制存储引擎 (Minute-Based Storage)**：为彻底杜绝浮点数精度丢失，数据库所有时长（如 Block Time, PIC Time）**一律采用 INTEGER 存储绝对分钟数**（例：2小时30分存为 150），前端展示与导出时动态格式化为 HH:MM。
    
3.  **带 DST 感知的离线时区库**：App 内置《主要机场 ICAO 对应 UTC 偏移字典》。**💡 新增规则**：当识别到非中国大陆机场（非 Z 开头 ICAO）时，UI 需展示推算出的 UTC 偏移量（如 UTC-5），并允许飞行员手动点击覆写调整（以应对欧美夏令时），确保 LT 转换 UTC 绝对精准。
    
4.  **API 缓存代理 (Cloudflare Workers + KV)**：客户端严禁直连开源航班 API。通过 Cloudflare Workers 边缘节点代理转发，配合 KV 缓存（7 天 TTL）防止 API 配额浪费。查询超时 3000ms 强制熔断降级。
    
    -   **数据源瀑布流**：AirLabs v9 (1000 次/月) → AviationStack (备用, 500 次/月)。
    -   **缓存策略**：首查 KV，命中则秒回（<50ms）；未命中则请求上游 API，写入 KV。
    -   **返回字段只含**：`dep_icao`, `arr_icao`, `aircraft_icao`, `reg_number`。严禁返回时间点。
    
5.  **强隔离离线同步架构**：前端采用 WatermelonDB 保障 100% 离线读写。云端架构采用 Supabase (PostgreSQL + Auth)，利用其天然的 Row Level Security (RLS) 与服务端 `moddatetime` 时间戳触发器，完美解决多租户混流鉴权以及飞行员跨时区导致的客户端时间错乱同步遗漏问题。本地表结构包含 UUID, is_deleted, last_modified_at, sync_status 用以支撑合并引擎。
    

## 三、 动态双轨交互与核心业务流程 (Dual-Track UI)

系统采用**状态记忆机制**，自动记忆用户上次选择的 DUTY 与 A/C Type。  
**💡 基础输入约束**：所有涉及机型、机场代码、航班号的 TextInput 必须设置 autoCapitalize="characters" 并 autoCorrect={false}。

### 3.1 顶级全局控件

-   **DUTY 选择器**：单选 [ FLIGHT (真实飞行) ] 或 [ SIMULATOR (模拟机) ]。切换时触发脏数据清洗。
    
-   **时区切换器**：全局 [ LT (当地时间) ] / [ UTC ]。默认常驻 LT。
    

### 3.2 FLIGHT (真实飞行) 模式视图

-   **免冒号时间输入**：纯数字键盘（如输入 0830 自动格式化为 08:30）。
    
-   **四点时间轴与智能推算**：
    
    -   OFF (撤轮档) / TO (起飞) / LDG (着陆) / ON (挡轮档)
        
    -   **智能推算**：若填入了 TO 和 LDG，静默推算：OFF = TO - 10分钟，ON = LDG + 5分钟。
        
    -   **跨零点绝对推算**：若后一节点数值小于前一节点，不仅分钟数 +24H，底层需**隐式增加该事件对应的真实 UTC Date**。
        
-   **夜航智能提示**：若 LDG 或 ON 时间在当地 19:00 之后，UI 对“夜航时间”输入框做微弱高亮提示。
    
-   **专业字段**：PIC/SIC/Dual/Instructor、Day/Night 起飞与落地。
    
-   **备注扩展**：提供 [+ PIC U/S] 快捷按钮，一键在备注栏追加“监视下履行机长职责”标签。
    

### 3.3 SIMULATOR (模拟机) 模式视图

-   **专属字段**：SIM No.、SIM CAT、Training Agency、Training Type。
    
-   **时间控件**：复用时钟结构，UI 变为 From (起始) / To (结束)，自动计算 Duty Time。

### 3.4 航班号智能填充 (Phase 6)

-   **触发机制**：航班号输入框失焦 (onBlur) 且航班号 ≥4 字符且日期已填 且 DUTY=FLIGHT 时触发。
    
-   **数据源**：调用 Cloudflare Worker 代理层（AirLabs → AviationStack 瀑布流）。
    
-   **填充规则**：
    -   ✅ 仅填充 **空字段**：出发站 (DEP)、到达站 (ARR)、航空器型别、航空器登记号。
    -   ❌ **严禁** API 覆盖时间轴 OFF/T\/O/LDG/ON（局方审查红线）。
    -   ❌ **不覆盖** 用户已手动填写的字段。
    
-   **降级策略**：3 秒超时 / 无网 / 查不到 → 微型 spinner 静默消失，不弹任何报错弹窗。
    
-   **视觉反馈**：拉取中显示微型 ActivityIndicator，成功填充后显示 ✨ 图标 2 秒后消失。
    
-   **航班号清洗**：去除空格、强制大写；ICRO 3 字母前缀（如 CCA→CA）由 Worker 端处理。

## 四、 核心合规防呆与 Dashboard (Compliance)

### 4.1 合规校验红线 (Blocker)

点击保存时，强制校验公式：

> pic_min + sic_min + dual_min + instructor_min <= block_time_min

💡 业务解释：各项经历时间之和允许**等于**或**小于**飞行时间 (Block Time)（小于的部分视为扩编机组的巡航机长/休息时间）。但如果**大于**飞行时间，直接阻断保存并标红。

### 4.2 Dashboard 数据物理隔离与 90 天监控

-   **时长隔离**：“真实飞行时间”与“模拟机时间”分为两个独立卡片，严禁混合。
    
-   **90天近期飞行经历监控 (CCAR-121.435 核心护航)**：
    
    -   **时区基准**：强制取 **北京时间 (UTC+8)** 的自然日零点回溯 90 天（防止因跨国飞行手机切时区导致资质状态横跳）。
        
    -   **计算红线**：独立统计过去 90 天内的起飞总数（昼+夜）与全停着陆总数（昼+夜）。
        
    -   **预警机制**：起飞或着陆任一项 ≤ 3 次触发**黄牌预警**；= 0 次触发**红牌阻断级警告**；≥ 4 次保持绿牌。

## 五、 双格式导出策略 (Dual-Format Export)

### 5.1 📄 导出标准 PDF (Print-Ready PDF) - 主推

-   **业务定位**：正式打印、局方审查、教员签字。
    
-   **视觉规范**：强制横屏 (Landscape)。每页容纳 15~20 条。
    
-   **合规页脚 (Must Have)**：每页底部自动生成 本页合计、以往累计、总计，并强制留出 [ 飞行员签字 ______ ] 与 [ 教员签字 ______ ] 与 [ 审查员签字 ______ ] 的空白划线。
    

### 5.2 📊 导出原始 Excel (Data Backup Excel)

-   **业务定位**：数据备份、PC端二次透视。纯净数据表格，基于 SheetJS (xlsx) 生成。

### 5.3 严格导出时区策略 (Strict Timezone Policy)

-   **业务限制**：严禁系统开放动态任选时区 (LT) 的功能。
-   **合规基准**：受 CCAR-61 及 CCAR-121 有关飞行时间限制和疲劳管理的审计要求，导出报表的时间轴必须绝对连续。
-   **唯一合法选项**：仅支持全局选定 **UTC (协调世界时)** 或局方唯一认可的国内运行标准时间 **Beijing LT (UTC+8)** 进行导出，用以保证飞行履历的法律效力与防篡改性。
    
### 5.4 导出列头映射规则 (复刻局方标准本)

| **序号** | **纸质本标准列头** | **数据源映射字段** | **格式化规范 / 约束** |
|---|---|---|---|
| 1 | 日期 | `actl_date` | YYYY-MM-DD |
| 2 | 航空器型别 | `acft_type` | 强制大写 |
| 3 | 航空器登记号 | `reg_no` | 强制大写 |
| 4 | 航段 | `dep_icao` - `arr_icao` | 拼接（ZBAA-ZSSS）。SIM留空 |
| 5 | 飞行时间 | `block_time_min` | HH:MM。SIM留空 |
| 6 | 机长 (PIC) | `pic_min` | HH:MM |
| 7 | PIC U/S | `pic_us_min` | HH:MM。监视下履行机长职责 |
| 8 | 见习机长 (SPIC) | `spic_min` | HH:MM |
| 9 | 副驾驶 (SIC) | `sic_min` | HH:MM |
| 10 | 带飞 (Dual) | `dual_min` | HH:MM |
| 11 | 教员 (Instructor) | `instructor_min` | HH:MM |
| 12 | 夜航 (Night) | `night_flight_min` | HH:MM |
| 13 | 仪表 (Inst) | `instrument_min` | HH:MM |
| 14 | 进近方式 | `approach_type` | 文本 (ILS/VOR/RNP) |
| 15 | 昼间起降 | `day_to` / `day_ldg` | 输出格式：起飞数/着陆数 (如 1/1) |
| 16 | 夜间起降 | `night_to` / `night_ldg` | 输出格式：起飞数/着陆数 (如 1/1) |
| 17 | 模拟机时间 | `block_time_min` | HH:MM（仅 SIM 模式填入此列） |
| 18 | 备注 | `flight_no` + `pilot_role` + `remarks` | 拼接输出 (如 CA1501 PIC U/S 气象雷达不工作) |

## 六、 核心数据字典 (Data Schema V1.1)

💡 所有时间点均存储 UTC 时间戳字符串，所有时长均存储 INTEGER 分钟数。

| **字段名 (Field)** | **数据库类型** | **约束** | **业务映射与说明 (Business Rules)** |
|---|---|---|---|
| **id** | `VARCHAR(36)` | 必填 | 客户端生成的 UUID |
| **duty_type** | `VARCHAR(20)` | 必填 | FLIGHT / SIMULATOR |
| **flight_no** | `VARCHAR(20)` | 选填 | 航班号 |
| **reg_no** | `VARCHAR(20)` | 选填 | 航空器登记号 |
| **schd_date** | `DATE` | 必填 | 计划日期（排班比对） |
| **actl_date** | `DATE` | 必填 | 实际日期 |
| **acft_type** | `VARCHAR(20)` | 必填 | 航空器型别（带记忆） |
| **dep_icao / arr_icao** | `CHAR(4)` | 选填 | 出发站/到达站 (SIM 模式存 NULL) |
| **off_time_utc** | `DATETIME` | 必填 | 撤轮档 OFF (SIM 模式复用为 From) |
| **to_time_utc** | `DATETIME` | 选填 | 起飞 T/O (Takeoff) |
| **ldg_time_utc** | `DATETIME` | 选填 | 着陆 LDG (Landing) |
| **on_time_utc** | `DATETIME` | 必填 | 挡轮档 ON (SIM 模式复用为 To) |
| **block_time_min** | `INTEGER` | 必填 | 飞行时间(分钟)。系统相减生成 |
| **pic_min** | `INTEGER` | 必填 | 机长时间。默认 0 |
| **pic_us_min** | `INTEGER` | 选填 | PIC U/S (监视下履行机长职责) 时间。默认 0 |
| **spic_min** | `INTEGER` | 选填 | 见习机长 (SPIC) 时间。默认 0 |
| **sic_min** | `INTEGER` | 必填 | 副驾驶时间。默认 0 |
| **dual_min / instructor_min** | `INTEGER` | 必填 | 带飞/教员时间。默认 0 |
| **night_flight_min** | `INTEGER` | 必填 | 夜航时间。默认 0 |
| **instrument_min** | `INTEGER` | 必填 | 仪表飞行时间。默认 0 |
| **pilot_role** | `VARCHAR(20)` | 选填 | 操纵角色：PF (操纵驾驶员) / PM (监控驾驶员) |
| **approach_type** | `VARCHAR(20)` | 选填 | 进近方式 |
| **day_to / night_to** | `TINYINT` | 选填 | 昼/夜起飞次数。默认 0 |
| **day_ldg / night_ldg** | `TINYINT` | 必填 | 昼/夜着陆次数。默认 0 |
| **sim_no** | `VARCHAR(20)` | 选填 | 模拟机编号 |
| **sim_cat** | `VARCHAR(20)` | 选填 | FSTD 鉴定等级 |
| **training_agency** | `VARCHAR(50)` | 选填 | 训练机构 |
| **training_type** | `VARCHAR(20)` | 选填 | 训练种类 |
| **remarks** | `TEXT` | 选填 | 自定义备注 |
| **uuid** | `VARCHAR(36)` | 选填 | RFC 4122 UUID，Phase 5 云同步预留 |
| **is_deleted** | `BOOLEAN` | 必填 | 软删除标记，默认 False |
| **last_modified_at** | `DATETIME` | 必填 | 最后修改时间 (UTC) |
| **sync_status** | `VARCHAR(20)` | 必填 | LOCAL_ONLY (V1.0 默认值) |

## 🗺️ 七、 开发路径 (Development Roadmap)

为最大程度避免代码重构，研发团队请严格按以下 5 个 Sprints 推进：

-   **📍 Phase 1: 基础设施与本地数据库**
    
    -   配置 Expo (Brownfield接入) 及 WatermelonDB 底层依赖。
        
    -   编写 schema.ts（大宽表）与 LogbookRecord.ts 模型。
        
-   **📍 Phase 2: 核心引擎与算法库**
    
    -   编写无依赖的纯函数：时间换算 TimeUtils.ts (0830 -> 08:30)、跨日及 UTC 推算 FlightMath.ts。
        
    -   编写合规校验引擎 ComplianceValidator.ts。配置 Jest 单元测试。
        
-   **📍 Phase 3: 动态双轨表单搭建 (UI)**
    
    -   搭建 React Navigation 4 屏骨架。
        
    -   封装 MaskedTimeInput 数字键盘组件。
        
    -   实现录入页 FLIGHT/SIMULATOR 动态表单及脏数据清洗。
        
-   **📍 Phase 4: 响应式绑定与 90 天 Dashboard**
    
    -   引入 @nozbe/with-observables 实现 UI 与数据库的 60fps 响应式绑定。
        
    -   依据北京时间基准，开发 90 天近期飞行经历 Dashboard（红黄绿警示卡片）。
        
-   **📍 Phase 5: 双轨导出闭环**
    
    -   集成 expo-print 编写 HTML/CSS 局方报表模板，实现带签字栏的 PDF 导出。
        
    -   集成 SheetJS 实现 Excel 备份导出。
        
-   **📍 Phase 6: 云端智能代理层 (Serverless)**
    
    -   搭建 Cloudflare Worker + KV 代理节点（零成本），对接 AirLabs / AviationStack 航班数据 API。
        
    -   编写 App 端 ApiService.ts（3 秒熔断、静默降级）。
        
    -   在 DualTrackForm 实现航班号失焦自动填充（仅填空字段，不覆盖时间轴）。

-   **📍 Phase 7: Supabase 免费云端双向同步闭环**
    
    -   集成 Supabase Auth。
    -   开发 `SyncService.ts`，基于 WatermelonDB `synchronize()` api 打造 pull / push 调度循环。
    -   在 Supabase 控制台完成 PostgreSQL 结构映射、RLS 行级安全设置以及针对 Client Clock Drift 的 `moddatetime` 时间同步触发器设定。