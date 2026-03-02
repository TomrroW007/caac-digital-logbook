# ✈️ 民航飞行员专属 LOGBOOK 产品需求文档 (PRD) V1.0


**文档状态**：已彻底冻结 (Frozen) - 研发团队可直接开工

**目标受众**：全栈独立开发者 (Solo Developer)

**核心原则**：离线绝对优先、全量 LT 极简录入、分钟制整数存储、动态双轨表单、双格式合规导出

## 一、 产品概述 (Product Overview)

### 1.1 背景与痛点

传统纸质飞行经历记录本存在携带不便、跨时区计算易错、90天近期经历难以实时监控等痛点。市面现有工具缺乏对 CAAC (CCAR-61部) 精细化填报及教员实地签字场景的本土化支持。

### 1.2 产品目标 (V1.0 范围)

打造一款专业供飞行员个人使用的电子 LOGBOOK。 **V1.0 核心战略**：**暂缓云端同步，主打“纯本地极致体验 + PDF/Excel 双轨导出闭环”**。通过第三方 API 智能拉取、纯数字免冒号输入、离线时区计算，实现秒级合规录入，并直接输出可供局方审查的标准化打印件


## 二、 系统架构设计 (System Architecture)

**核心架构规范**：

1.  **离线优先 (Offline-First)**：所有操作 100% 读写本地 SQLite (通过 WatermelonDB 驱动)。
    
2.  **分钟制存储引擎 (Minute-Based Storage)**：为彻底杜绝浮点数精度丢失，数据库所有时长（如 Block Time, PIC Time）**一律采用 `INTEGER` 存储绝对分钟数**（例：2小时30分存为 `150`），仅在前端展示与导出时动态格式化为 `X:XX` / `HH:MM`。
    
3.  **内置离线时区库**：App 需本地打包一份《全球主要机场 ICAO 对应时区字典(JSON)》，确保断网时输入的当地时间 (LT) 能精准转换为 UTC 落盘。
    
4.  **API 缓存代理 (Proxy & Cache)**：客户端严禁直连开源航班 API。需通过自有 Node.js 后端代理转发并配置 Redis 缓存，查询超时 3000ms 强制熔断，无缝降级为纯手工模式。
    
5.  **云端同步架构预留**：V1.0 暂不开发多端同步，但本地表结构必须按同步标准建立（包含 UUID, `is_deleted`, `last_modified_at`, `sync_status` 等）。


## 三、 动态双轨交互与核心业务流程 (Dual-Track UI & Flows)

系统采用**状态记忆机制 (Memory State)**，自动记忆用户上次选择的 `DUTY` 与 `A/C Type`。

### 3.1 顶级全局控件

-   **DUTY 选择器**：首列展现，单选 `[ FLIGHT (真实飞行) ]` 或 `[ SIMULATOR (模拟机) ]`。切换时自动清洗非当前模式的脏数据。
    
-   **时区切换器**：全局 `[ LT (当地时间) ] / [ UTC ]`。**默认常驻 LT**，输入与展示均为当地时间，底层存 UTC。
    

### 3.2 FLIGHT (真实飞行) 模式视图

-   **免冒号时间输入**：所有时间输入框唤起**纯数字键盘**（如输入 0830 自动格式化为 08:30）。
    
-   **四点时间轴与智能推算**：
    
    -   `OFF (撤轮挡)` / `TO (起飞)` / `LDG (落地)` / `ON (挡轮挡)`
        
    -   **智能推算**：若填入了 `TO` 和 `LDG` 且 `OFF/ON` 为空，系统静默推算：`OFF = TO - 10分钟`，`ON = LDG + 5分钟`。
        
    -   **跨零点自适应**：若后一节点数值小于前一节点，系统自动按 +24 小时跨日计算，避免负数。
        
-   **专业字段**：`PIC / SIC` (附加 PF/PM 选择)、`Day/Night LDG`、`TYPE OF APP (进近类型)`。
    

### 3.3 SIMULATOR (模拟机) 模式视图

-   **专属字段**：`SIM No. (编号)`、`SIM CAT (等级)`、`Training Agency (训练机构)`、`Training Type (训练类型)`。
    
-   **时间控件**：复用底层时钟结构，UI 变更为 `From (起始)` / `To (结束)`。系统自动计算 `Duty Time`。
    

----------

## 四、 核心合规防呆与 Dashboard (Compliance & Dashboard)

### 4.1 合规校验红线 (Blocker)

点击保存时，前端必须强制校验：

> `pic_min + sic_min + dual_min + instructor_min <= block_time_min`
> 
> _(若各项细分经历时间之和大于总时长，直接阻断保存并标红，防止局方判定“造假”)_

### 4.2 Dashboard 数据物理隔离

-   **时长隔离**：“真实飞行总时长”与“模拟机总时长”在首页分为两个独立卡片，严禁混合相加。
    
-   **90天近期经历监控**：取设备当前时区的自然日零点回溯 90 天。仅累加 `DUTY = FLIGHT` 且 `is_deleted = 0` 的起降数。**昼/夜落地任一项 $\le$ 3 次触发黄牌预警，= 0 次触发红牌阻断级警告。**
    

----------

## 五、 双格式导出策略 (Dual-Format Export) 🌟核心新增

导出设置页提供两种纯本地生成的导出选项：

### 5.1 📄 导出标准 PDF (Print-Ready PDF) - 主推功能

-   **业务定位**：直接用于正式打印、教员审查与签字留档。
    
-   **视觉与分页规范**：强制横屏 (Landscape)，严格复刻 CCAR-61 标准列头。每页固定容纳 15~20 条记录，页脚自动生成合规栏位：`本页合计`、`以往累计`、`总计`，并强制留出 `[ 飞行员签字 ______ ]` 与 `[ 教员/审查人签字 ______ ]` 的空白划线。
    
-   **技术方案**：基于 `expo-print`，使用预设的 HTML/CSS 模板注入 SQLite 遍历数据，本地毫秒级生成 PDF 并唤起系统分享/打印。
    

### 5.2 📊 导出原始 Excel (Data Backup Excel) - 辅助功能

-   **业务定位**：用于飞行员个人数据备份、迁移与电脑端二次数据透视/微调。
    
-   **视觉规范**：纯净的数据表格，包含标准表头，无需分页符和签字栏。
    
-   **技术方案**：基于 `SheetJS (xlsx)` 与 `expo-file-system` 本地生成。

### 5.3 导出列头映射规则 (适用于 PDF & Excel)

_所有时长字段导出时格式化为 `HH:MM`。如果是 SIMULATOR 记录，总飞行时间、航段等列留空，时间单独记入“模拟机时间”列。_

| 序号 | 纸质本标准列头 | 数据源映射字段 | 格式化规范 / 约束 |
|---:|---|---|---|
| 1 | 日期 (Date) | `actl_date` | YYYY-MM-DD |
| 2 | 航空器型别 (Type) | `acft_type` | 大写 |
| 3 | 航空器登记号 (Reg No.) | `reg_no` | 大写 |
| 4 | 航段 (Route) | `dep_icao - arr_icao` | 拼接（如 ZBAA-ZSSS）。模拟机留空 |
| 5 | 飞行总时间 (Total Time) | `block_time_min` | HH:MM。模拟机留空 |
| 6 | 机长 (PIC) | `pic_min` | HH:MM |
| 7 | 副驾驶 (SIC) | `sic_min` | HH:MM |
| 8 | 带飞 (Dual Received) | `dual_min` | HH:MM |
| 9 | 教员 (Instructor) | `instructor_min` | HH:MM |
| 10 | 夜航 (Night Flight) | `night_flight_min` | HH:MM |
| 11 | 仪表 (Instrument) | `instrument_min` | HH:MM |
| 12 | 进近类型 (Type of APP) | `approach_type` | 文本输出 |
| 13 | 昼间起降 (Day Ldg) | `day_ldg` | 数字 |
| 14 | 夜间起降 (Night Ldg) | `night_ldg` | 数字 |
| 15 | 模拟机时间 (Sim Time) | `block_time_min` | HH:MM（仅当 duty_type=SIMULATOR 时填入此列，第5列留空） |
| 16 | 备注 (Remarks) | `flight_no + remarks` | 拼接输出 |


## 六、 核心数据字典 (Data Schema)

| 字段名 (Field) | 数据库类型 | 约束 | 业务映射与说明 (Business Rules) |
|---|---|---|---|
| `id` | VARCHAR(36) | 必填 | 客户端生成的 UUID |
| `duty_type` | VARCHAR(20) | 必填 | 枚举：FLIGHT / SIMULATOR |
| `flight_no` | VARCHAR(10) | 选填 | 航班号，如 CA1501 |
| `schd_date` | DATE | 必填 | 计划日期（排班比对） |
| `actl_date` | DATE | 必填 | 实际日期（Dashboard 90天检索基准） |
| `acft_type` | VARCHAR(20) | 必填 | 机型（A320等，带记忆） |
| `dep_icao / arr_icao` | CHAR(4) | 选填 | 起降机场。SIM 模式存 NULL |
| `off_time_utc` | DATETIME | 必填 | 撤轮挡 (SIM 模式复用为 From) |
| `to_time_utc` | DATETIME | 选填 | 起飞 (Takeoff)。SIM 模式存 NULL |
| `ldg_time_utc` | DATETIME | 选填 | 落地 (Landing)。SIM 模式存 NULL |
| `on_time_utc` | DATETIME | 必填 | 挡轮挡 (SIM 模式复用为 To) |
| `block_time_min` | INTEGER | 必填 | 总时长(分钟)。前端相减生成，不可手填 |
| `pic_min / sic_min` | INTEGER | 必填 | 机长/副驾时间(分钟)。默认 0 |
| `dual_min / instructor_min` | INTEGER | 必填 | 带飞/教员时间(分钟)。默认 0 |
| `pilot_role` | VARCHAR(10) | 选填 | PF 或 PM |
| `approach_type` | VARCHAR(20) | 选填 | 进近类型 (ILS, VOR 等) |
| `sim_no / sim_cat` | VARCHAR(50) | 选填 | 模拟机编号/等级。FLIGHT 模式存 NULL |
| `day_ldg / night_ldg` | TINYINT | 必填 | 昼/夜落地数。默认 0 |
| `remarks` | TEXT | 选填 | 自定义备注 |
| `is_deleted` | BOOLEAN | 必填 | 软删除标记，默认 False |
| `last_modified_at` | DATETIME | 必填 | 最后修改时间 (UTC) |
| `sync_status` | VARCHAR(20) | 必填 | 预留：LOCAL_ONLY (V1.0 默认值) |


## 🚀 七、 开发前最终 Go/No-Go 多方专家审阅结论

> 👨‍✈️ **【民航运行专家 SME】 - 🟢 GO** “引入 PDF 并加入底部合计与教员签字栏，真正击穿了飞行员的痛点。拿着这个 PDF 去局方盖章完全合规。双轨导出策略考虑得极其成熟。”

> 👨‍💻 **【首席架构师 Tech Lead】 - 🟢 GO** “Expo 生态中用 HTML/CSS 结合 `expo-print` 渲染复杂表格和分页是最稳健的做法，规避了原生 PDF 绘制引擎的排版地狱。`INTEGER` 存储和离线时区库的防雷设计依然是这套架构的定海神针。”

> 🎨 **【交互设计师 UI/UX】 - 🟢 GO** “Export 页面提供两个清晰的引导按钮（PDF 打印版 / Excel 备份版），对用户心智的教育非常友好。录入页面的纯数字键盘和智能推算大幅降低了交互摩擦。”

> 🔬 **【高级测试工程师 QA】 - 🟢 GO** “合规红线公式 `PIC+SIC+Dual+Inst <= Block` 和 跨零点逻辑极其清晰。后续基于这份 PRD 编写自动化测试脚本将非常顺畅。无阻碍，同意放行。”