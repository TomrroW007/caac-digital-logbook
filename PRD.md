
# ✈️ 民航飞行员专属 LOGBOOK 产品需求文档 (PRD) V1.1 终定版

**文档状态**：已彻底冻结 (Frozen) - 研发团队可直接开工  
**目标受众**：全栈独立开发者 (Solo Developer)  
**合规基准**：严格遵循 CCAR-61部、CCAR-121部 及 ICAO 附件1  
**核心原则**：离线绝对优先、全量 LT 极简录入、分钟制整数存储、动态双轨表单、双格式合规导出

### 📝 V1.1 专家审阅修订记录 (Changelog)

1.  **合规修正**：将“起降”拆分为“起飞(T/O)”与“落地(LDG)”，满足 CCAR-61 近期经历 3次起飞+3次落地的独立审计要求。
    
2.  **时区防雷**：增加非大陆机场的夏令时(DST)手动覆写机制；明确 90 天看板统一按 **北京时间(UTC+8)** 计算自然日零点，防止跨时区红黄牌横跳。
    
3.  **交互增强**：强制 ICAO/机型 等字段大写且关闭自动纠错；增加夜航时间漏填的 UI 智能弱提示；备注支持一键追加 PICUS 标签。

## 一、 产品概述 (Product Overview)

### 1.1 背景与痛点

传统纸质飞行经历记录本存在携带不便、跨时区计算易错、90天近期经历难以实时监控等痛点。市面现有工具缺乏对 CAAC (CCAR-61部) 精细化填报、夏令时自适应及教员实地签字场景的本土化支持。

### 1.2 产品目标 (V1.0 范围)

打造一款专业供飞行员个人使用的电子 LOGBOOK。 **V1.0 核心战略**：**暂缓云端同步，主打“纯本地极致体验 + PDF/Excel 双轨导出闭环”**。通过纯数字免冒号输入、带 DST 感知的离线时区计算，实现秒级合规录入，并直接输出可供局方盖章的标准化打印件。

## 二、 系统架构设计 (System Architecture)

**核心架构规范**：

1.  **离线优先 (Offline-First)**：所有操作 100% 读写本地 SQLite (通过 WatermelonDB 驱动，启用 JSI 加速)。
    
2.  **分钟制存储引擎 (Minute-Based Storage)**：为彻底杜绝浮点数精度丢失，数据库所有时长（如 Block Time, PIC Time）**一律采用 INTEGER 存储绝对分钟数**（例：2小时30分存为 150），前端展示与导出时动态格式化为 HH:MM。
    
3.  **带 DST 感知的离线时区库**：App 内置《主要机场 ICAO 对应 UTC 偏移字典》。**💡 新增规则**：当识别到非中国大陆机场（非 Z 开头 ICAO）时，UI 需展示推算出的 UTC 偏移量（如 UTC-5），并允许飞行员手动点击覆写调整（以应对欧美夏令时），确保 LT 转换 UTC 绝对精准。
    
4.  **API 缓存代理 (Proxy & Cache)**：客户端严禁直连开源航班 API。需通过自有 Node.js 后端代理转发并配置 Redis 缓存，查询超时 3000ms 强制熔断降级。
    
5.  **云端架构预留**：本地表结构包含 UUID, is_deleted, last_modified_at, sync_status。
    

## 三、 动态双轨交互与核心业务流程 (Dual-Track UI)

系统采用**状态记忆机制**，自动记忆用户上次选择的 DUTY 与 A/C Type。  
**💡 基础输入约束**：所有涉及机型、机场代码、航班号的 TextInput 必须设置 autoCapitalize="characters" 并 autoCorrect={false}。

### 3.1 顶级全局控件

-   **DUTY 选择器**：单选 [ FLIGHT (真实飞行) ] 或 [ SIMULATOR (模拟机) ]。切换时触发脏数据清洗。
    
-   **时区切换器**：全局 [ LT (当地时间) ] / [ UTC ]。默认常驻 LT。
    

### 3.2 FLIGHT (真实飞行) 模式视图

-   **免冒号时间输入**：纯数字键盘（如输入 0830 自动格式化为 08:30）。
    
-   **四点时间轴与智能推算**：
    
    -   OFF (撤轮挡) / TO (起飞) / LDG (落地) / ON (挡轮挡)
        
    -   **智能推算**：若填入了 TO 和 LDG，静默推算：OFF = TO - 10分钟，ON = LDG + 5分钟。
        
    -   **跨零点绝对推算**：若后一节点数值小于前一节点，不仅分钟数 +24H，底层需**隐式增加该事件对应的真实 UTC Date**。
        
-   **夜航智能提示**：若 LDG 或 ON 时间在当地 19:00 之后，UI 对“夜航时间”输入框做微弱高亮提示。
    
-   **专业字段**：PIC/SIC/Dual/Instructor、Day/Night 起飞与落地。
    
-   **备注扩展**：提供 [+ PICUS] 快捷按钮，一键在备注栏追加“机长受监视飞行”标签。
    

### 3.3 SIMULATOR (模拟机) 模式视图

-   **专属字段**：SIM No.、SIM CAT、Training Agency、Training Type。
    
-   **时间控件**：复用时钟结构，UI 变为 From (起始) / To (结束)，自动计算 Duty Time。

## 四、 核心合规防呆与 Dashboard (Compliance)

### 4.1 合规校验红线 (Blocker)

点击保存时，强制校验公式：

> pic_min + sic_min + dual_min + instructor_min <= block_time_min

💡 业务解释：各项经历之和允许**等于**或**小于**总时长（小于的部分视为扩编机组的巡航机长/休息时间）。但如果**大于**总时长，直接阻断保存并标红。

### 4.2 Dashboard 数据物理隔离与 90 天监控

-   **时长隔离**：“真实飞行总时长”与“模拟机总时长”分为两个独立卡片，严禁混合。
    
-   **90天近期经历监控 (CCAR-121.435 核心护航)**：
    
    -   **时区基准**：强制取 **北京时间 (UTC+8)** 的自然日零点回溯 90 天（防止因跨国飞行手机切时区导致资质状态横跳）。
        
    -   **计算红线**：独立统计过去 90 天内的起飞总数（昼+夜）与全停落地总数（昼+夜）。
        
    -   **预警机制**：起飞或落地任一项 ≤ 3 次触发**黄牌预警**；= 0 次触发**红牌阻断级警告**；≥ 4 次保持绿牌。

## 五、 双格式导出策略 (Dual-Format Export)

### 5.1 📄 导出标准 PDF (Print-Ready PDF) - 主推

-   **业务定位**：正式打印、局方审查、教员签字。
    
-   **视觉规范**：强制横屏 (Landscape)。每页容纳 15~20 条。
    
-   **合规页脚 (Must Have)**：每页底部自动生成 本页合计、以往累计、总计，并强制留出 [ 飞行员签字 ______ ] 与 [ 教员/审查人签字 ______ ] 的空白划线。
    

### 5.2 📊 导出原始 Excel (Data Backup Excel)

-   **业务定位**：数据备份、PC端二次透视。纯净数据表格，基于 SheetJS (xlsx) 生成。
    
### 5.3 导出列头映射规则 (复刻局方标准本)

| **序号** | **纸质本标准列头** | **数据源映射字段** | **格式化规范 / 约束** |
|---|---|---|---|
| 1 | 日期 | `actl_date` | YYYY-MM-DD |
| 2 | 航空器型别 | `acft_type` | 强制大写 |
| 3 | 航空器登记号 | `reg_no` | 强制大写 |
| 4 | 航段 | `dep_icao` - `arr_icao` | 拼接（ZBAA-ZSSS）。SIM留空 |
| 5 | 飞行总时间 | `block_time_min` | HH:MM。SIM留空 |
| 6 | 机长 (PIC) | `pic_min` | HH:MM |
| 7 | 副驾驶 (SIC) | `sic_min` | HH:MM |
| 8 | 带飞 (Dual) | `dual_min` | HH:MM |
| 9 | 教员 (Instructor) | `instructor_min` | HH:MM |
| 10 | 夜航 (Night) | `night_flight_min` | HH:MM |
| 11 | 仪表 (Inst) | `instrument_min` | HH:MM |
| 12 | 进近类型 | `approach_type` | 文本 (ILS/VOR/RNP) |
| 13 | 昼间起降 | `day_to` / `day_ldg` | 输出格式：起飞数/落地数 (如 1/1) |
| 14 | 夜间起降 | `night_to` / `night_ldg` | 输出格式：起飞数/落地数 (如 1/1) |
| 15 | 模拟机时间 | `block_time_min` | HH:MM（仅 SIM 模式填入此列） |
| 16 | 备注 | `flight_no` + `pilot_role` + `remarks` | 拼接输出 (如 CA1501 PICUS 气象雷达不工作) |

## 六、 核心数据字典 (Data Schema V1.1)

💡 所有时间点均存储 UTC 时间戳字符串，所有时长均存储 INTEGER 分钟数。

| **字段名 (Field)** | **数据库类型** | **约束** | **业务映射与说明 (Business Rules)** |
|---|---|---|---|
| **id** | `VARCHAR(36)` | 必填 | 客户端生成的 UUID |
| **duty_type** | `VARCHAR(20)` | 必填 | FLIGHT / SIMULATOR |
| **flight_no / reg_no** | `VARCHAR(20)` | 选填 | 航班号 / 航空器注册号 |
| **schd_date** | `DATE` | 必填 | 计划日期（排班比对） |
| **actl_date** | `DATE` | 必填 | 实际日期 |
| **acft_type** | `VARCHAR(20)` | 必填 | 机型（带记忆） |
| **dep_icao / arr_icao** | `CHAR(4)` | 选填 | 起降机场 (SIM 模式存 NULL) |
| **off_time_utc** | `DATETIME` | 必填 | 撤轮挡 (SIM 模式复用为 From) |
| **to_time_utc** | `DATETIME` | 选填 | 起飞 (Takeoff) |
| **ldg_time_utc** | `DATETIME` | 选填 | 落地 (Landing) |
| **on_time_utc** | `DATETIME` | 必填 | 挡轮挡 (SIM 模式复用为 To) |
| **block_time_min** | `INTEGER` | 必填 | 总时长(分钟)。系统相减生成 |
| **pic_min / sic_min** | `INTEGER` | 必填 | 机长/副驾时间。默认 0 |
| **dual_min / instructor_min** | `INTEGER` | 必填 | 带飞/教员时间。默认 0 |
| **pilot_role** | `VARCHAR(20)` | 选填 | PF / PM / PICUS (机长受监视) |
| **approach_type** | `VARCHAR(20)` | 选填 | 进近类型 |
| **day_to / night_to** | `TINYINT` | 必填 | 昼/夜起飞次数。默认 0 |
| **day_ldg / night_ldg** | `TINYINT` | 必填 | 昼/夜落地次数。默认 0 |
| **remarks** | `TEXT` | 选填 | 自定义备注 |
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
        
-   **📍 Phase 4: 响应式绑定与 90 天看板**
    
    -   引入 @nozbe/with-observables 实现 UI 与数据库的 60fps 响应式绑定。
        
    -   依据北京时间基准，开发 90 天起降看板（红黄绿警示卡片）。
        
-   **📍 Phase 5: 双轨导出闭环与 API 预留**
    
    -   集成 expo-print 编写 HTML/CSS 局方报表模板，实现带签字栏的 PDF 导出。
        
    -   集成 SheetJS 实现 Excel 备份导出。
        
    -   （可选）搭建 Node.js 极简后端，利用 Redis 缓存对接外部航空 API。