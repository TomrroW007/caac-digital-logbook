# ✈️ 民航飞行员专属 LOGBOOK 产品需求文档 (PRD) V1.0

**文档版本**：V1.0 (最终核准版) 

**面向对象**：研发团队 (前端/后端/DBA)、测试团队 (QA)、UI/UX 设计师

**核心原则**：离线优先 (Offline-First)、CAAC/ICAO 规章合规、极简录入

## 一、 产品概述 (Product Overview)

### 1.1 背景与痛点

传统纸质飞行经历记录本存在携带不便、跨时区时长计算易错、难以实时统计“90天近期经历”以保持资质等痛点。市面上现有的部分工具要么过于臃肿，要么不符合中国民航局 (CAAC) 的精细化填报规范。

### 1.2 产品目标

打造一款纯粹、专业、供飞行员个人使用的电子 LOGBOOK。通过“第三方开源 API 智能拉取 + 离线本地存储 + 渐进式表单”的组合，实现秒级录入与合规预警，并支持一键导出符合局方标准的 Excel 报表。

## 二、 系统架构设计 (System Architecture)

> 👨‍💻 **Tech Lead 审阅批注**：本系统严禁客户端直连外部开源 API（规避 Key 泄露与 IP 封禁）。必须走后端代理与 Redis 缓存。核心数据必须优先落盘本地 SQLite。

**核心架构规范**：

1.  **离线优先 (Offline-First)**：所有增删改查动作直接与本地 SQLite/IndexedDB 交互，确保机舱断网环境下 100% 可用。
    
2.  **静默同步 (Silent Sync)**：网络恢复后，本地 `sync_status = 0` 的增量数据通过后台队列推送到云端 MySQL 进行备份。采用“最后修改时间优先 (Last Write Wins)”解决多端冲突。
    
3.  **API 缓存代理 (Proxy & Cache)**：获取航班号信息的请求发往自有后端，后端先查询 Redis（24小时缓存），未命中再请求 OpenSky 等开源接口。

## 三、 核心业务流程 (Core User Flows)

### 3.1 极简录入流 (Happy Path - 依赖网络)

1.  用户进入录入页，输入 `计划日期 (SCHD DATE)` 和 `航班号 (FLT NO.)`。
    
2.  系统请求接口，若为直飞，静默带出起降机场、机型、撤/挡轮挡时间；若为经停（多航段），底部弹出“航段选择器”供用户选择。
    
3.  前端自动计算出总飞行时长 (Block Time)。
    
4.  用户展开“经历时间面板”，输入机长(PIC)/副驾(SIC)时间及昼夜落地数，点击保存。
    

### 3.2 手工兜底流 (Fallback Path - 断网/查无航班)

1.  若 API 请求超时 (>3000ms) 或处于断网模式，系统提示“已切换至手工模式”。
    
2.  用户手动填写起降机场 (ICAO) 及所有时间（UTC），系统依旧自动计算时长。

## 四、 核心功能模块需求 (Functional Requirements)

### 4.1 数据录入与管理模块 (Data Entry)

-   **时区处理**：底层强制以 UTC 时间戳计算和存储。前端提供 `[LT / UTC]` 视觉切换开关，根据机场 ICAO 代码自动推算 LT (当地时间) 供用户核对。
    
-   **渐进式 UI 面板**：
    
    -   默认常驻：日期、航班号、起降机场、撤/挡轮挡时间、总飞行时长、起降次数。
        
    -   折叠区域（点击展开）：机长 (PIC)、副驾驶 (SIC)、带飞 (Dual)、教员 (Instructor)、仪表 (Instrument)、夜航 (Night)。
        
-   **防错校验 (合规红线)**：点击保存时，前端强制校验：`PIC + SIC + Dual + Instructor <= 总飞行时长`。若超出，阻断保存并标红提示。
    
-   **软删除机制**：用户在列表左滑删除记录时，本地数据库标记 `is_deleted = 1`，列表隐藏，待联网时同步云端。
    

### 4.2 数据看板模块 (Dashboard)

-   **90天近期经历监控**：
    
    -   触发基准：取设备当前所在时区的“自然日零点”。
        
    -   计算逻辑：动态回溯过去 90 天，累加 `is_deleted = 0` 的记录中的昼间落地数与夜间落地数。
        
    -   UI 预警：总数 <= 3 次时，图标变黄；= 0 次时，图标变红。
        
-   **累计数据汇总**：展示用户的历史总飞行时间、本月已飞时间。
    

### 4.3 局方标准 Excel 导出模块 (Export)

-   **纯本地生成**：不依赖后端，前端通过本地 DB 数据直接利用 JS/原生库生成 `.xlsx` 文件。
    
-   **CAAC 列头映射规则**：
    
    -   `Date` -> `actl_date`
        
    -   `Type` -> `acft_type`
        
    -   `Reg No.` -> `reg_no`
        
    -   `Route` -> `dep_icao` to `arr_icao`
        
    -   `Total Time` -> `block_time`
        
    -   分列展示经历时间：`PIC`, `SIC`, `Dual`, `Instructor`, `Instrument`, `Night`。
        
    -   分列展示起降：`Day Landings`, `Night Landings`。

## 五、 数据字典与底层结构 (Data Dictionary)

> 👨‍⚖️ **DBA 审阅批注**：主键必须用 UUID 防止离线自增冲突。时间统一使用 DATETIME (UTC)。

| **字段名 (Field)** | **含义 (Name)** | **类型 (Type)** | **属性** | **备注 (Remarks)** |  
|---|---|---|---|---|  
| `id` | 唯一主键 | VARCHAR(36) | 必填 | 客户端生成的 UUID |  
| `user_id` | 用户ID | VARCHAR(36) | 必填 | 关联用户账号体系 |  
| `flight_no` | 航班号 | VARCHAR(10) | 选填 | 例：CA1501 |  
| `schd_date` | 计划日期 | DATE | 必填 | 用于排班比对 |  
| `actl_date` | 实际日期 | DATE | 必填 | Excel 导出 90 天计算基准 |  
| `dep_icao` | 起飞机场 | CHAR(4) | 必填 | 例：ZBAA |  
| `arr_icao` | 降落机场 | CHAR(4) | 必填 | 例：ZSSS |  
| `out_time_utc` | 撞轮档 (UTC) | DATETIME | 必填 | 跨零点计算基准 |  
| `in_time_utc` | 挡轮档 (UTC) | DATETIME | 必填 | 晚于 out_time_utc |  
| `block_time` | 总飞行时长 | DECIMAL(5,1) | 必填 | 前端只读，系统相减生成 |  
| `pic_time` | 机长时间 | DECIMAL(5,1) | 必填 | 默认 0.0 |  
| `sic_time` | 副驾时间 | DECIMAL(5,1) | 必填 | 默认 0.0 |  
| `day_landings` | 昼间落地 | TINYINT | 必填 | 默认 0 |  
| `night_landings` | 夜间落地 | TINYINT | 必填 | 默认 0 |  
| `is_deleted` | 软删除标记 | TINYINT(1) | 必填 | 1=已删除，0=正常（默认） |  
| `last_modified` | 最后修改时间 | DATETIME | 必填 | 解决多端覆盖冲突的核心依据 |  
| `sync_status` | 本地同步状态 | TINYINT(1) | 必填 | 仅客户端存在。0=待同步，1=已同步 |

## 六、 非功能性需求与约束 (Non-Functional Requirements)

1.  **API 超时熔断**：外部航班查询接口的最大等待时间为 **3000ms**。超时必须立刻释放 UI 线程，进入手工模式。
    
2.  **时钟防篡改**：App 在每次网络连接成功时，需拉取服务器的 UTC 时间，计算与本地手机系统时间的 `Offset`（差值）。写入数据库的 `last_modified` 必须是 `本地时间 + Offset`，防止用户手机时区错乱导致同步逻辑崩溃。
    
3.  **性能体验**：在低端设备上进行 10,000 条本地 SQLite 数据的列表滑动时，需保证 60fps 的流畅度（引入分页加载或虚拟列表技术）。