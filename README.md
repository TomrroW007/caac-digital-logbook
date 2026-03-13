# CAAC 数字飞行记录本 (CAAC Digital Logbook) ✈️

[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://github.com/your-repo/caac-digital-logbook)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Web-lightgrey.svg)]()
[![Compliance](https://img.shields.io/badge/compliance-CCAR--61-success.svg)]()

专为中国民航飞行员打造的现代、离线优先的数字飞行记录本。基于 React Native (Expo) 构建，支持多端数据同步，严格遵循中国民用航空局 (CAAC) CCAR-61 部及 CCAR-121 部的管理和审计要求。

## ✨ 核心特性 (V1.5.0)

* **离线优先 (Offline-First)：** 采用 WatermelonDB，在飞行模式或弱网环境下依然可以极速录入和查询，网络恢复后自动同步。
* **局方合规与校验：** * 内置 CCAR-61 逻辑校验 (如 `PIC + SIC + DUAL + INSTR <= BLOCK`)。
    * 基于北京时间 (UTC+8) 的严格 90 天近期经历窗口计算。
* **审计级数据导出：** 一键生成符合局方审查标准的 PDF（A4 横向排版、底部签字栏、分页总计）和 Excel 原数据，严格锁定 UTC/北京本地时间以防时区漂移。
* **云端安全同步：** 采用 Supabase 无密码 (OTP) 邮箱登录。行级安全策略 (RLS) 确保您的飞行数据仅您自己可见。
* **历史数据导入：** 提供标准 Excel 模板，支持一键批量导入历史记录，自动去重。

## 🚀 快速开始

### 环境依赖
* Node.js >= 18.0
* Expo CLI
* Supabase 免费账号 (用于开启云端同步)

### 安装与运行
```bash
# 1. 克隆代码并安装依赖
git clone https://github.com/your-repo/caac-digital-logbook.git
cd caac-digital-logbook
npm install

# 2. 配置 Supabase 环境变量 (请复制 .env.example 为 .env)
# EXPO_PUBLIC_SUPABASE_URL=your-project-url
# EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# 3. 启动开发服务器
npx expo start
```

## 🛠 技术栈
* **前端:** React Native / Expo, React Navigation
* **本地数据库:** WatermelonDB (SQLite)
* **云端与鉴权:** Supabase (PostgreSQL, GoTrue Auth)
* **数据导出:** expo-print (PDF), xlsx (Excel SheetJS), expo-sharing

## 📄 许可证
本项目采用 [MIT License](LICENSE) 授权。