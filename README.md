# ✈️ Pilot Logbook (民航飞行员电子飞行记录本)

> 一款专为民航飞行员打造的离线优先 (Offline-First)、极简智能且严格符合 CAAC/ICAO 标准的个人专属电子飞行经历记录本。

## 🎯 核心特性 (Core Features)

* **📴 离线优先架构 (Offline-First)**：核心数据（SQLite）完全落盘本地。在机舱断网环境下拥有 100% 完整录入功能；网络恢复后静默增量同步至云端。
* **🧠 智能填报引擎 (Smart Autofill)**：输入“日期+航班号”，通过后端代理与 Redis 缓存层调用开源 API（如 OpenSky），静默带出起降机场、机型、撤/挡轮挡时间，秒级完成记录。
* **⚖️ 绝对合规 (CAAC/ICAO Compliant)**：
    * 底层统一采用 **UTC 时间戳** 存储与计算，彻底解决跨时区算错时间的痛点。
    * 系统自动计算总飞行时长 (`block_time`)，并严格校验 `PIC + SIC + Dual + Instructor <= 总时长` 的业务红线。
* **📊 90天近期经历看板**：根据设备当前时区的自然日零点，动态回溯计算过去 90 天内起降次数，护航客运飞行资质。
* **🖨️ 纯本地 Excel 导出**：不依赖后端，客户端直接生成完美映射 CAAC 纸质本列头的标准 Excel 报表。

## 🏗️ 系统架构 (Architecture)

* **客户端 (Client)**：UI 渲染 + 本地 SQLite + 离线同步引擎 (Sync) + 本地 Excel 生成器。
* **服务端 (Server)**：JWT 鉴权 + MySQL 云端备份 + API 代理转发层 (Proxy) + Redis 缓存 (防 API 限流)。
* **数据同步策略**：采用软删除 (`is_deleted`) 配合最后修改时间 (`last_modified_at`) 解决多端覆盖冲突 (Last Write Wins)。

## 📝 核心业务规则必读 (Business Rules)

1.  **一航段一记录**：若 API 查到经停航班，必须让用户选择实际执飞航段，严禁合并记录。
2.  **API 熔断机制**：外部航班查询接口设定 **3000ms 超时熔断**。若超时，立即释放 UI 线程，降级为手工兜底录入。
3.  **时间防篡改**：本地记录的修改时间需根据服务器 UTC 偏移量 (Offset) 进行校准，不可绝对信任设备本地时间。

## 🚀 快速开始 (Getting Started)

*(待开发团队补充：环境配置、安装依赖与启动项目的具体 npm/yarn/pod 命令)*

---
*Designed & Architected for Pilots.*
