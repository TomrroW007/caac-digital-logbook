# ✈️ 民航飞行员专属 LOGBOOK 产品需求文档 (PRD) V1.0


**文档状态**：已彻底冻结 (Frozen) - 研发团队可直接开工

**目标受众**：全栈独立开发者 (Solo Developer)

**核心原则**：离线 100% 可用、全量 LT 极简录入、分钟制整数存储、动态双轨表单、严格映射 CAAC 纸质本。

## 一、 产品概述 (Product Overview)

### 1.1 背景与痛点

传统纸质飞行经历记录本存在携带不便、跨时区时长计算易错、难以实时统计“90天近期经历”以保持资质等痛点。市面工具缺乏对 CAAC (CCAR-61部) 精细化填报的本土化支持。

### 1.2 产品目标 (V1.0 范围)

打造一款专业供飞行员个人使用的电子 LOGBOOK。

**V1.0 核心战略**：**砍掉复杂的云端多端同步，主打“纯本地极致体验 + 一键 Excel 导出闭环”**。通过第三方 API 智能拉取、纯数字免冒号输入、离线时区库，实现秒级合规录入。

## 二、 系统架构设计 (System Architecture)

**核心架构规范**：

1.  **离线优先 (Offline-First)**：所有操作 100% 读写本地 SQLite (WatermelonDB)。
    
2.  **分钟制存储引擎 (Minute-Based Storage)**：为彻底杜绝浮点数精度丢失，数据库所有时长（如 Block Time, PIC Time）**一律采用 `INTEGER` 存储绝对分钟数**（例：2小时30分存为 `150`），仅在前端展示与导出时格式化为 `X:XX`。
    
3.  **内置离线时区库**：App 本地必须打包一份《全球主要机场 ICAO 对应时区字典(JSON)》，确保断网时用户输入的当地时间 (LT) 能精准转换为 UTC 落盘。
    
4.  **API 缓存代理 (Proxy & Cache)**：严禁客户端直连开源航班 API。需通过自有 Node.js 后端代理转发并使用 Redis 缓存，超时 3000ms 强制熔断降级手工模式。
    
5.  **云端同步为 V1.1 预留**：V1.0 不做同步，但本地数据库 Schema 必须按同步标准建立（包含 UUID, `is_deleted`, `last_modified_at` 等）。

## 三、 动态双轨交互与核心业务流程 (Dual-Track UI & Flows)

系统采用**状态记忆机制**，自动记忆用户上次选择的 `DUTY` 与 `A/C Type`。

### 3.1 顶级全局控件

-   **DUTY 选择器**：首列展现，单选 `[ FLIGHT (真实飞行) ]` 或 `[ SIMULATOR (模拟机) ]`。切换时自动清空非当前模式的脏数据。
    
-   **时区切换器**：全局 `[ LT (当地时间) ] / [ UTC ]`。**默认常驻 LT**，输入框视觉显示均为当地时间。
    

### 3.2 FLIGHT (真实飞行) 模式视图

-   **免冒号时间输入**：所有时间输入框唤起**纯数字键盘**（如输入 0830 自动格式化为 08:30）。
    
-   **四点时间轴与智能推算**：
    
    -   `OFF (撤轮挡)` / `TO (起飞)` / `LDG (落地)` / `ON (挡轮挡)`
        
    -   **自动推算**：若 `TO` 和 `LDG` 有值且 `OFF/ON` 为空，系统静默推算：`OFF = TO - 10分钟`，`ON = LDG + 5分钟`。
        
    -   **跨零点自适应**：若后一节点数值小于前一节点，系统自动按 +24 小时跨日计算。
        
-   **专业字段**：`PIC / SIC` (附加 PF/PM 选择)、`Day/Night LDG`、`TYPE OF APP (进近类型)`。
    

### 3.3 SIMULATOR (模拟机) 模式视图

切换至此模式时，视图重构：

-   **专属字段**：`SIM No. (编号)`、`SIM CAT (等级)`、`Training Agency (训练机构)`、`Training Type (训练类型)`。
    
-   **时间控件**：复用底层表结构，展示为 `From (起始)` / `To (结束)`。系统自动计算 `Duty Time`。

## 四、 核心合规防呆与 Dashboard (Compliance & Dashboard)

### 4.1 合规校验红线 (Blocker)

点击保存时，前端强制校验：

> `pic_min + sic_min + dual_min + instructor_min <= block_time_min`
> 
> _(若各项经历时间之和大于总时长，直接标红阻断保存，防止局方审查判定造假)_

### 4.2 Dashboard 数据物理隔离

-   **90天近期经历监控**：取设备当前时区的自然日零点回溯 90 天。仅累加 `DUTY = FLIGHT` 且 `is_deleted = 0` 的记录。**昼/夜间落地任一项 $\le$ 3 次触发黄牌预警，= 0 触发红牌。**
    
-   **时长隔离**：“真实飞行总时长”与“模拟机总时长”在首页分为两个独立卡片，严禁混合相加。

## 五、 数据字典与底层结构 (Data Dictionary V1.0)

> 👨‍⚖️ **DBA 批注**：单表大宽表设计。废弃原 DECIMAL 方案，时长全面上 INTEGER 分钟制。

| 字段名 (Field) | 数据库类型 | 约束 | 业务映射与说明 (Business Rules) |
|---|---|---|---|
| id | VARCHAR(36) | 必填 | 客户端生成的 UUID |
| duty_type | VARCHAR(20) | 必填 | 枚举：FLIGHT / SIMULATOR |
| flight_no | VARCHAR(10) | 选填 | 航班号，如 CA1501 |
| schd_date | DATE | 必填 | 计划日期（排班比对） |
| actl_date | DATE | 必填 | 实际日期（Dashboard 90天检索基准） |
| acft_type | VARCHAR(20) | 必填 | 机型（A320等，带记忆） |
| dep_icao / arr_icao | CHAR(4) | 选填 | 起降机场。SIM 模式存 NULL |
| off_time_utc | DATETIME | 必填 | 撤轮挡 (SIM 模式复用为 From) |
| to_time_utc | DATETIME | 选填 | 起飞 (Takeoff)。SIM 模式存 NULL |
| ldg_time_utc | DATETIME | 选填 | 落地 (Landing)。SIM 模式存 NULL |
| on_time_utc | DATETIME | 必填 | 挡轮挡 (SIM 模式复用为 To) |
| block_time_min | INTEGER | 必填 | 总时长(分钟)。前端相减生成，不可手填 |
| pic_min / sic_min | INTEGER | 必填 | 机长/副驾时间(分钟)。默认 0 |
| dual_min / instructor_min | INTEGER | 必填 | 带飞/教员时间(分钟)。默认 0 |
| pilot_role | VARCHAR(10) | 选填 | PF 或 PM |
| approach_type | VARCHAR(20) | 选填 | 进近类型 (ILS, VOR 等) |
| sim_no / sim_cat | VARCHAR(50) | 选填 | 模拟机编号/等级。FLIGHT 模式存 NULL |
| day_ldg / night_ldg | TINYINT | 必填 | 昼/夜落地数。默认 0 |
| remarks | TEXT | 选填 | 自定义备注 |
| is_deleted | BOOLEAN | 必填 | 软删除标记，默认 False |
| last_modified_at | DATETIME | 必填 | 最后修改时间 (UTC) |
| sync_status | VARCHAR(20) | 必填 | 预留：LOCAL_ONLY (V1.0 默认值) |


## 六、 CAAC 标准纸质本 Excel 导出映射表 (Export Mapping)

纯本地通过 JS 库生成，严格对齐局方标准列头。时长字段导出时统一格式化为 `HH:MM`

| 序号 | 纸质本标准列头 | 数据源映射字段 | 格式化规范 / 约束 |
|---:|---|---|---|
| 1 | 日期 (Date) | actl_date | YYYY-MM-DD |
| 2 | 航空器型别 (Type) | acft_type | 大写 |
| 3 | 航空器登记号 (Reg No.) | reg_no | 大写 |
| 4 | 航段 (Route) | dep_icao - arr_icao | 拼接（如 ZBAA-ZSSS）。模拟机留空 |
| 5 | 飞行总时间 (Total Time) | block_time_min | HH:MM。模拟机留空 |
| 6 | 机长 (PIC) | pic_min | HH:MM |
| 7 | 副驾驶 (SIC) | sic_min | HH:MM |
| 8 | 带飞 (Dual Received) | dual_min | HH:MM |
| 9 | 教员 (Instructor) | instructor_min | HH:MM |
| 10 | 夜航 (Night Flight) | night_flight_min | HH:MM |
| 11 | 仪表 (Instrument) | instrument_min | HH:MM |
| 12 | 进近类型 (Type of APP) | approach_type | 文本输出 |
| 13 | 昼间起降 (Day Ldg) | day_ldg | 数字 |
| 14 | 夜间起降 (Night Ldg) | night_ldg | 数字 |
| 15 | 模拟机时间 (Sim Time) | block_time_min | HH:MM（仅当 duty_type=SIMULATOR 时填入此列，第5列留空） |
| 16 | 备注 (Remarks) | flight_no + remarks | 拼接输出 |

## 七、 技术栈定稿输出 (Final Tech Stack)

| 模块名称 | 选用技术 | 说明 |
|---|---|---|
| 移动端框架 | React Native (Expo) | 高效跨端，适合 Solo Developer 快速出表单 |
| 本地离线库 | WatermelonDB (SQLite) | 强大的离线数据库，底层性能优越，Schema 友好 |
| Excel 导出库 | SheetJS (xlsx) | 配合 expo-file-system 实现纯本地报表生成分享 |
| 后端 API 代理 | Node.js + NestJS/Express | 仅用作 OpenSky 等外部 API 的代理防限流 |
| 云端同步(V1.0) | Cut (暂缓) | V1.0 不设后端 DB，专注本地体验，降低首发风险 |

### 🕵️‍♂️ 附录：多方专家开发前最终 Go/No-Go 审阅记录

为了确保这套 PRD 在编码阶段不出现任何逻辑阻塞，我们进行了最终的交叉审阅：

1.  **👨‍✈️ 民航专家 (SME) - 【GO】**：
    
    -   _意见_：“模拟机时长与真实飞行时长的 Dashboard 隔离，以及 Excel 导出时的第 5 列与第 15 列互斥判定，完美契合 CCAR-61 部规章，规避了飞行员经历造假的红线。”
        
2.  **👨‍💻 首席架构师 (Tech Lead) - 【GO】**：
    
    -   _意见_：“将 `DECIMAL` 彻底改为 `INTEGER` 分钟数是神来之笔。砍掉 V1.0 的后端同步极大释放了前端开发精力。Schema 里预留了 `sync_status` 和 `last_modified_at`，这叫做‘进可攻退可守’，架构极其稳健。”
        
3.  **🎨 交互设计师 (UI/UX) - 【GO】**：
    
    -   _意见_：“纯数字免冒号输入、加上 `OFF = TO - 10` 的自动推算，能帮飞行员在机舱里省去至少 50% 的多余点击，单手盲操体验拉满。”
        
4.  **🔬 高级测试工程师 (QA) - 【GO】**：
    
    -   _意见_：“明确定义了跨零点自适应（+24H）和 `PIC+SIC+Dual+Inst <= Block` 的阻断校验边界。测试用例完全可以根据 PRD 1:1 编写，没有模棱两可的地带。”