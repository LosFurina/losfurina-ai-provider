# LosFurina AI Provider Dashboard V2 — 设计文档

> 日期: 2026-06-10
> 状态: 待批准
> 关联前置: `2026-06-10-losfurina-ai-provider-proxy-design.md`

## 1. 概述

将现有的"单页内联 Dashboard + 单 Provider 透传"升级为生产级 AI 网关控制台，并支持**多 Provider 后端聚合**与**健康监测**。

**核心目标：**

- 让个人/小团队使用的 AI 网关在监控、分析、调试和告警方面达到 OpenRouter、Helicone、Vercel Analytics 等成熟商业产品的体验水准
- 支持配置多个后端 Provider（不同的 base URL + API key），按模型自动路由
- 对所有 Provider 主动健康探测，在 Dashboard 集中展示可用性

**设计风格：** Linear / Raycast 开发者审美 — 深色主题、紧凑信息密度、毛玻璃效果、流畅过渡动画、⌘K 命令面板。

**面向用户：** 个人开发者，自用监控自己的 AI API 调用情况（不涉及多用户、配额、计费等 SaaS 化场景）。

## 2. 范围与非目标

### 包含

- 5 个核心页面：Overview、Logs、Analytics、Playground、Health
- 1 个设置页面：Settings（费用单价配置 + 告警规则）
- 全局 ⌘K 命令面板（快速跳转 + 搜索）
- 智能告警系统（错误率、费用、延迟阈值触发）
- 费用追踪与估算（按模型单价计算）
- 全文搜索 + 保存过滤视图
- **多 Provider 路由**：按 `model` 字段路由到对应后端，`/v1/models` 聚合所有 Provider 模型
- **Provider 健康监测**：Cron Trigger 主动探测，可用性历史趋势
- **自动模型发现**：探测时自动同步每个 Provider 的模型列表

### 非目标

- 多用户 / 团队权限管理
- 配额 / 限速 / 计费
- 复杂的请求追踪 (tracing) / 调用链分析
- Provider 管理 UI（增删改通过直接写 D1 实现，Dashboard 仅展示）
- 模型重复时的 fallback / 负载均衡（同一模型唯一 Provider，靠 priority 决定归属）
- 移动端响应式（桌面优先，min-width 1024px 起步）

## 3. 架构

### 3.1 部署架构

将前端从 Worker 内联 HTML 拆离，使用 Cloudflare Workers 的 [Static Assets](https://developers.cloudflare.com/workers/static-assets/) 功能托管。

```
┌────────────────────────────────────────────────┐
│  Cloudflare Worker                             │
│  ├── /v1/models      → 聚合所有 Provider 模型   │
│  ├── /v1/*           → 按 model 路由到 Provider │
│  ├── /api/*          → Dashboard JSON API       │
│  ├── /api/admin/*    → 告警/配置管理 API        │
│  └── 其他            → Static Assets            │
│                        (index.html, JS, CSS)    │
│                                                 │
│  Cron Trigger (*/5min)                          │
│  └── 探测所有 Provider /v1/models               │
│      ├── 更新 providers.health_status            │
│      ├── 同步 providers.models JSON              │
│      └── 写入 provider_health_logs              │
└────────────────────────────────────────────────┘
         │
         ├── D1: logs (现有)
         ├── D1: pricing (新增 — 单价配置)
         ├── D1: alert_rules / alert_triggers (新增)
         ├── D1: providers (新增 — 后端配置 + 模型)
         └── D1: provider_health_logs (新增 — 探测历史)
```

### 3.2 前端文件结构

```
public/
├── index.html               # SPA 入口（暗色主题、字体、根容器）
├── app.js                   # 主应用逻辑（路由、状态、API 客户端）
├── styles.css               # 全局样式（Linear 风格主题）
├── pages/
│   ├── overview.js          # Overview 页面渲染
│   ├── logs.js              # Logs 页面渲染
│   ├── analytics.js         # Analytics 页面渲染
│   ├── playground.js        # Playground 页面渲染
│   ├── health.js            # Health 页面渲染（Provider 状态 + 探测历史）
│   └── settings.js          # Settings 页面渲染
├── components/
│   ├── sidebar.js           # 侧边栏导航
│   ├── command-palette.js   # ⌘K 命令面板
│   ├── side-panel.js        # 通用滑出面板
│   ├── json-viewer.js       # JSON 语法高亮
│   └── filters.js           # 过滤器组件
└── vendor/
    └── uplot.min.js         # CDN fallback 本地化（可选）

src/
├── index.js                 # 路由分发（保持精简）
├── scheduled.js             # 新增：Cron Trigger 入口（Provider 健康探测）
├── routes/
│   ├── proxy.js             # /v1/* 代理（按 model 路由到 Provider）
│   ├── models.js            # /v1/models 聚合返回
│   ├── api-logs.js          # /api/logs* 现有 API
│   ├── api-providers.js     # 新增：/api/providers 读取 Provider 列表 + 状态
│   ├── api-health.js        # 新增：/api/providers/:id/health 历史时序
│   ├── api-settings.js      # /api/admin/settings 新增
│   ├── api-alerts.js        # /api/admin/alerts 新增
│   └── api-playground.js    # /api/playground 代理转发（带 Worker key）
├── lib/
│   ├── auth.js              # 现有
│   ├── db.js                # 扩展：增加 settings/alerts/providers 查询
│   ├── pricing.js           # 新增：按模型计算费用
│   ├── alerts.js            # 新增：告警规则评估与触发
│   ├── router.js            # 新增：model → provider 路由查找
│   ├── healthcheck.js       # 新增：探测单个 Provider，更新 DB
│   ├── config.js            # 现有
│   └── ...                  # buffer.js / logger.js / telegram.js 保持
└── ...
```

### 3.3 前端技术栈

- **零构建** — 原生 ES Modules，`<script type="module">` 直接加载
- **零框架** — 原生 DOM + 模板字符串，避免 React/Vue 的构建链
- **路由** — `hash` 路由（`#/logs`、`#/analytics` 等），无需服务端配合
- **图表** — [uPlot](https://github.com/leeoniya/uPlot) (~40KB)，通过 CDN 引入，性能优秀适合时序数据
- **图标** — Lucide Icons（SVG 内联，按需复制）
- **字体** — 系统字体 + JetBrains Mono（代码块）

### 3.4 数据流

```
浏览器
  ├── 加载 /index.html（无需鉴权，纯静态）
  ├── 路由切换 → 调用 pages/*.js 渲染
  └── 调用 /api/* → 携带 sessionStorage 中的 token
                  ↓
Worker /api/*
  ├── 鉴权（验 WORKER_API_KEY）
  ├── 查询 D1
  ├── 评估告警规则（异步）
  └── 返回 JSON
```

## 4. 视觉与交互规范

### 4.1 设计 Token

```css
/* 背景层级 */
--bg-base:     #0a0c12;   /* 页面底色 */
--bg-elevated: #12151e;   /* 卡片/面板 */
--bg-overlay:  #1a1f2e;   /* hover / 浮层 */
--bg-active:   #2a2f3e;   /* 激活态 */

/* 边框 */
--border-subtle: #1e2330;
--border-default: #2a2f3e;
--border-strong:  #3a4055;

/* 文字 */
--text-primary:   #e2e8f0;
--text-secondary: #94a3b8;
--text-tertiary:  #64748b;
--text-disabled:  #475569;

/* 强调色 */
--accent-blue:   #3b82f6;  /* 主操作 */
--accent-purple: #a78bfa;  /* 命令面板 / 强调 */
--accent-green:  #4ade80;  /* 成功 / 实时 */
--accent-yellow: #fbbf24;  /* 费用 / 警告 */
--accent-red:    #ef4444;  /* 错误 */
--accent-pink:   #f472b6;  /* 辅助数据 */

/* 模型标签色（语义化） */
--model-claude:   #93c5fd on #1e3a5f
--model-openai:   #6ee7b7 on #1a3a2f
--model-deepseek: #c4b5fd on #2a1f3e
--model-other:    #cbd5e1 on #334155

/* 圆角 */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;

/* 阴影 */
--shadow-panel: 0 10px 40px rgba(0,0,0,0.4);
--shadow-glow:  0 0 24px rgba(59,130,246,0.15);

/* 字体 */
--font-sans: -apple-system, "Inter", "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
```

### 4.2 全局布局

```
┌─────────┬──────────────────────────────────┐
│ Sidebar │  Main Content                    │
│ 200px   │  ┌──────────────────────────────┐│
│         │  │ Page Header                  ││
│ ⌘K Bar  │  │ - 标题 + 副标题              ││
│         │  │ - 右侧操作（时间范围/筛选等）││
│ Nav     │  └──────────────────────────────┘│
│ - 📊 OV │  ┌──────────────────────────────┐│
│ - 📋 LG │  │ Page Body                    ││
│ - 📈 AN │  │ (按页面差异化布局)            ││
│ - 🧪 PG │  │                              ││
│ - 💚 HL │  │                              ││
│         │  │                              ││
│ ⚙ Set   │  └──────────────────────────────┘│
└─────────┴──────────────────────────────────┘

侧边栏导航项（自上而下）：
1. Overview      📊
2. Logs          📋
3. Analytics     📈
4. Playground    🧪
5. Health        💚  ← 新增；图标右侧小圆点显示整体状态（绿/黄/红）

底部:
- Settings ⚙
```

- 侧边栏固定 200px，主内容自适应宽度，最小 1024px
- 顶部告警 Banner（条件出现）

### 4.3 命令面板（⌘K）

- 全局快捷键 ⌘K / Ctrl+K 唤起
- 半透明遮罩 + 居中浮窗（宽 600px）
- 功能：
  - 跳转页面（"Go to Logs"、"Go to Analytics"）
  - 切换时间范围（"Last 24 hours"）
  - 快速过滤（"Show errors only"）
  - 直接全文搜索日志内容
- ESC 关闭，方向键导航，Enter 确认

### 4.4 滑出侧面板

用于日志详情、设置编辑等。

- 从右侧滑出，宽 480px（日志详情）或 600px（命令面板）
- 半透明遮罩，点遮罩或 ESC 关闭
- 顶部固定标题 + 关闭按钮
- 滚动条样式与主题一致

## 5. 页面详细设计

### 5.1 Overview 总览

**目的：** 一眼看到今日/本周整体状况。

**布局：**

```
[页面标题: Overview] [时间范围切换: 今日 / 7天 / 30天]

┌─────────┬─────────┬─────────┬─────────┐
│ 请求总量 │ Token   │ 成功率   │ 平均延迟 │
│ 1,247   │ 2.1M    │ 99.2%   │ 820ms   │
│ ↑12%    │ ~$4.20  │ 10 错误 │ ↓5%     │
└─────────┴─────────┴─────────┴─────────┘

┌─────────────────────────────────────────┐
│ 请求量趋势 (折线图 + 渐变填充)            │
└─────────────────────────────────────────┘

┌──────────────────────┬──────────────────┐
│ 最近活跃模型 (列表)   │ 最近错误 (列表)   │
│ - claude-4   342     │ - 429 @ 14:19    │
│ - gpt-4o     218     │ - 502 @ 13:45    │
│ - deepseek   687     │ - ...            │
└──────────────────────┴──────────────────┘
```

**交互：**
- KPI 卡片点击跳转到 Analytics 对应维度
- 趋势图 hover 显示精确数值 tooltip
- "最近错误"点击跳到 Logs 并自动过滤错误

### 5.2 Logs 日志浏览器

**目的：** 高密度展示日志列表，快速过滤和查看详情。

**布局：**

```
[标题: Logs] [● 实时指示器]
[搜索框 /] [模型 ▾] [状态 ▾] [耗时 ▾] [费用 ▾] [保存视图 ⭐]

┌──────────────────────────────────┬────────────┐
│ 时间  模型      状态  延迟  Token │ 详情面板    │
│ 14:23 claude-4  200  1.2s  3421 │ (滑出)     │
│ 14:21 gpt-4o    200  0.8s  1205 │            │
│ 14:19 claude-4  429  0.3s  —    │            │
│ ...                              │            │
│ [无限滚动加载]                    │            │
└──────────────────────────────────┴────────────┘
```

**列定义：**

| 列 | 宽度 | 内容 |
|---|---|---|
| 时间 | 70px | HH:MM:SS |
| 模型 | 100px | 带模型主题色的标签 |
| 状态 | 50px | 状态码 + 颜色（绿 2xx，红 4xx/5xx） |
| 延迟 | 60px | 自动单位（ms / s） |
| Tokens | 70px | 总 token 数 |
| 费用 | 80px | $X.XXX |
| 路径 | flex | URL pathname |

**过滤器细节：**

- **全文搜索（/）**：在 `request_body` 和 `response_body` 上做 LIKE 匹配，支持简单通配符 `*`
- **模型**：多选下拉，从数据库中提取去重模型列表
- **状态**：多选（2xx / 4xx / 5xx 分组）
- **耗时**：预设范围（< 500ms / 500ms-2s / > 2s）
- **费用**：预设范围（免费 / < $0.01 / $0.01-$0.10 / > $0.10）

**保存视图：**

- 当前的过滤组合可命名保存到 `localStorage`
- 侧边栏显示"我的视图"列表（如：今日错误、贵的请求、慢请求）
- 一键切换

**详情面板：**

```
[请求详情]                              [ESC]
┌──────────┬──────────┐
│ 模型     │ 状态     │
│ claude-4 │ 200 OK   │
├──────────┼──────────┤
│ 延迟     │ 费用     │
│ 1,203ms  │ $0.042   │
└──────────┴──────────┘

[请求 Tab] [响应 Tab] [元信息 Tab]

┌──────────────────────────────────┐
│ {                                │
│   "model": "claude-4",            │
│   "messages": [...]               │
│ }                                 │
│ [复制 JSON]                       │
└──────────────────────────────────┘
```

- 三个 Tab：请求 / 响应 / 元信息（Headers、IP、UserAgent 等）
- JSON 语法高亮，缩进可折叠
- 一键复制原始 JSON
- "在 Playground 中重发"按钮

### 5.3 Analytics 用量分析

**目的：** 深度分析费用与用量趋势。

**布局：**

```
[标题: Analytics] [时间范围: 24h / 7d / 30d]

┌──────────────┬──────────────┬──────────────┐
│ 本周费用      │ 本月累计      │ 日均费用     │
│ $12.47       │ $38.92       │ $1.78        │
│ ↑23% vs LW   │ 预估 $52.30  │ ↓5% vs avg   │
└──────────────┴──────────────┴──────────────┘

┌────────────────────────────┬──────────────┐
│ 费用趋势 (堆叠折线图)        │ 模型费用占比  │
│ - Prompt vs Completion 拆分 │ (Donut)      │
│ - 日粒度 / 时粒度切换        │              │
└────────────────────────────┴──────────────┘

┌────────────────────────────────────────────┐
│ 模型用量明细表                              │
│ Model | Req | Prompt | Compl | Total | Cost│
└────────────────────────────────────────────┘
```

**图表细节：**

- **费用趋势**：多线折线图，X 轴时间，Y 轴费用 USD。三条线：总费用（实线）/ Prompt（虚线）/ Completion（虚线）
- **模型占比**：环形图，中心显示总费用，右侧图例 + 百分比

### 5.4 Playground 测试工具

**目的：** 不离开 Dashboard 即可测试网关。

**布局：**

```
[标题: Playground]

┌──────────────────────────┬──────────────────────────┐
│ [模型 ▾] [params...] [▶发送]│ 延迟 1.2s · 470 tok · $X │
│                              │                          │
│ [system]                    │ [assistant]              │
│ You are a helpful...        │ Transformers use a       │
│                              │ self-attention...        │
│ [user]                      │                          │
│ Explain transformers...     │                          │
│                              │                          │
│ + 添加消息                  │ [渲染] [原始 JSON] [复制] │
└──────────────────────────┴──────────────────────────┘
```

**交互：**
- 左侧编辑器：可添加/删除 system / user / assistant 消息
- 参数：model（下拉选已配置的）、max_tokens、temperature
- 发送：调用 `/api/playground` → Worker 按 model 查 providers 表 → 转发到对应 Provider（使用该 Provider 的 api_key，无需用户填）
- 右侧响应：默认 Markdown 渲染，可切换原始 JSON
- 历史记录：保留最近 10 次会话到 localStorage

### 5.5 Health Provider 健康监测

**目的：** 集中展示所有后端 Provider 的可用性状态、模型覆盖、最近故障。

**布局：**

```
[标题: Health] [手动触发探测]  [自动探测: 每 5 分钟]

整体状态横条：
┌────────────────────────────────────────────────┐
│ 🟢 4/5 Providers Healthy · 87 Models Available │
└────────────────────────────────────────────────┘

Provider 卡片列表（每个 Provider 一行）：

┌────────────────────────────────────────────────────────┐
│ 🟢 OpenAI Official        priority: 10  enabled        │
│ https://api.openai.com/v1                              │
│ ─────────────────────────────────────────────────────  │
│ 状态: HEALTHY    延迟: 245ms  上次探测: 2分钟前          │
│ 模型: 24 个 (gpt-4o, gpt-4o-mini, gpt-4-turbo, ...) ▾   │
│ 24h 可用性: 99.7%                                       │
│ [可用性时序: ████████▌███████████████ ]                 │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ 🔴 Anthropic Backup       priority: 20  enabled        │
│ https://api.anthropic-proxy.example.com/v1             │
│ ─────────────────────────────────────────────────────  │
│ 状态: UNHEALTHY  延迟: —       上次探测: 30秒前          │
│ 最近错误: 502 Bad Gateway                              │
│ 模型: 上次成功探测时 8 个（claude-4, claude-3-5-sonnet）│
│ 24h 可用性: 62.3%                                       │
│ [可用性时序: ████████░░░░░████████████ ]                │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ ⚪ Local LM Studio         priority: 30  disabled      │
│ http://127.0.0.1:1234/v1                               │
│ (已禁用，不参与路由和探测)                              │
└────────────────────────────────────────────────────────┘
```

**Provider 卡片字段：**

| 字段 | 说明 |
|---|---|
| 状态徽章 | 🟢 healthy / 🟡 degraded（成功率 < 95%） / 🔴 unhealthy / ⚪ disabled |
| Priority | 数字优先级，模型冲突时数字小的胜出 |
| Base URL | 后端地址（脱敏：只显示前 40 字符） |
| 延迟 | 最近一次探测的响应时间 |
| 上次探测 | 相对时间（"2 分钟前"） |
| 模型列表 | 可点击展开查看完整模型清单，每个模型旁标注是否冲突 |
| 最近错误 | 最近一次失败的状态码 + 错误信息（仅 unhealthy 显示） |
| 24h 可用性 | 探测成功率（百分比） |
| 可用性时序 | 24 小时迷你心电图（每小时一格，绿/黄/红） |

**交互：**

- **手动触发探测按钮** — 立即对所有 enabled Provider 执行一次探测（绕过 Cron 间隔），便于刚改完 DB 立刻验证
- **点击 Provider 卡片** — 滑出侧面板，显示完整 24h 时序图（uPlot 折线图：延迟趋势 + 状态点）+ 最近 50 次探测记录表格
- **模型冲突提示** — 如果同一个模型在多个 Provider 出现，priority 高（数字小）的胜出，低优先级的会标注 ⚠️ "被 ProviderX 覆盖"
- **Empty state** — 当没有任何 Provider 时，显示提示："直接在 D1 中插入 `providers` 表数据，刷新此页面即可看到。"

**顶部整体状态横条颜色：**

- 全部 healthy → 绿
- 至少 1 个 unhealthy 但不全挂 → 黄
- 全挂 / 路由不可用 → 红（也作为 Banner 出现在全局顶部）

### 5.6 Settings 设置

**目的：** 配置费用单价和告警规则。

**布局：**

```
[Tab: 模型单价] [Tab: 告警规则] [Tab: 关于]

模型单价 Tab:
┌────────────────────────────────────────────┐
│ Model         | Prompt $/1K | Compl $/1K   │
│ claude-4     | $0.003      | $0.015        │
│ gpt-4o       | $0.0025     | $0.010        │
│ + 添加模型                                  │
└────────────────────────────────────────────┘

告警规则 Tab:
┌────────────────────────────────────────────┐
│ ☑ 错误率 > 5% (10分钟窗口) → Telegram      │
│ ☑ 单次请求费用 > $0.50    → Telegram + Banner│
│ ☐ 日费用 > $10            → Telegram        │
│ ☑ 延迟 > 10s              → Banner only    │
│ + 添加规则                                  │
└────────────────────────────────────────────┘
```

## 6. 后端 API 设计

### 6.1 新增 / 调整端点

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/logs` | GET | ✅ | 现有 — 扩展支持 `search`、`status`、`min_duration`、`max_duration`、`min_cost`、`max_cost`、`limit`、`offset`、`cursor` |
| `/api/logs/stats` | GET | ✅ | 现有 — 扩展支持时间粒度（`granularity=hour|day`） |
| `/api/logs/timeseries` | GET | ✅ | 新增 — 返回时序数据（请求量、费用、延迟），供图表使用 |
| `/api/logs/:id` | GET | ✅ | 新增 — 获取单条日志完整详情 |
| `/api/models` | GET | ✅ | 新增 — 返回去重模型列表 + 单价 |
| `/api/admin/pricing` | GET/PUT | ✅ | 新增 — 模型单价配置 |
| `/api/admin/alerts` | GET/PUT/DELETE | ✅ | 新增 — 告警规则 CRUD |
| `/api/admin/alerts/triggered` | GET | ✅ | 新增 — 最近触发的告警记录 |
| `/api/playground` | POST | ✅ | 新增 — 转发请求到对应 Provider（按 model 路由） |
| `/api/providers` | GET | ✅ | 新增 — Provider 列表 + 当前健康状态 + 模型清单 |
| `/api/providers/:id/health` | GET | ✅ | 新增 — Provider 24h 探测历史时序 |
| `/api/providers/probe` | POST | ✅ | 新增 — 手动触发对所有 enabled Provider 的探测 |
| `/v1/models` | GET | ✅ | **改造** — 聚合所有 enabled + healthy Provider 的模型列表 |
| `/v1/chat/completions` 等 | POST | ✅ | **改造** — 按 `model` 字段查 `providers` 表路由 |

### 6.2 响应示例

`GET /api/logs/timeseries?hours=168&granularity=hour&metric=cost`:

```json
{
  "buckets": [
    { "ts": "2026-06-04T00:00:00Z", "value": 1.23, "breakdown": { "claude-4": 0.80, "gpt-4o": 0.43 } },
    { "ts": "2026-06-04T01:00:00Z", "value": 0.92, "breakdown": { ... } }
  ]
}
```

`GET /api/providers`:

```json
[
  {
    "id": 1,
    "name": "OpenAI Official",
    "base_url": "https://api.openai.com/v1",
    "priority": 10,
    "enabled": true,
    "health_status": "healthy",
    "last_latency_ms": 245,
    "last_checked_at": "2026-06-10T14:23:00Z",
    "uptime_24h": 0.997,
    "model_count": 24,
    "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", ...],
    "last_error": null
  },
  {
    "id": 2,
    "name": "Anthropic Backup",
    "health_status": "unhealthy",
    "last_error": "502 Bad Gateway",
    ...
  }
]
```

`GET /api/providers/1/health?hours=24`:

```json
{
  "buckets": [
    { "ts": "2026-06-10T00:00:00Z", "status": "healthy", "latency_ms": 234 },
    { "ts": "2026-06-10T00:05:00Z", "status": "healthy", "latency_ms": 251 },
    ...
  ]
}
```

### 6.3 多 Provider 路由逻辑

请求处理顺序（适用于 `/v1/chat/completions` 等）：

```
1. 鉴权
2. 解析请求体 → 提取 model 字段
3. 查询：SELECT * FROM providers
        WHERE enabled = 1
          AND health_status != 'unhealthy'
          AND json_extract(models, '$') LIKE '%"<model>"%'
        ORDER BY priority ASC
        LIMIT 1
4. 若未命中：
   - providers 表为空 → 503 `{"error":"no providers configured","hint":"insert into providers table to start routing"}`
   - 模型存在但所有持有该模型的 Provider 都 unhealthy → 503 Service Unavailable
   - 模型完全不存在 → 404 `{"error":"model not found","model":"<requested>"}`
5. 命中：
   - 重写请求 URL 为 provider.base_url + 原 pathname
   - 替换 Authorization 头为 provider.api_key
   - 转发请求
6. 写日志时记录 provider_id（logs 表新增字段）
```

### 6.4 `/v1/models` 聚合

```
1. SELECT models, priority FROM providers
   WHERE enabled = 1 AND health_status = 'healthy'
   ORDER BY priority ASC

2. 合并所有 models 数组，按 priority 顺序遍历，重复模型只保留第一次出现的

3. 返回 OpenAI 兼容格式：
   {
     "object": "list",
     "data": [
       { "id": "gpt-4o", "object": "model", "owned_by": "openai-official" },
       { "id": "claude-4", "object": "model", "owned_by": "anthropic-backup" },
       ...
     ]
   }
```

## 7. 数据库扩展

### 7.1 现有 `logs` 表扩展

```sql
ALTER TABLE logs ADD COLUMN cost_usd REAL DEFAULT 0;
ALTER TABLE logs ADD COLUMN source TEXT DEFAULT 'proxy';        -- 'proxy' | 'playground'
ALTER TABLE logs ADD COLUMN provider_id INTEGER REFERENCES providers(id);

CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status);
CREATE INDEX IF NOT EXISTS idx_logs_cost ON logs(cost_usd);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider_id);
```

`cost_usd` 在写入时根据 `pricing` 表计算并冻结。
`provider_id` 记录这次请求转发到了哪个 Provider，方便后续按 Provider 维度做统计。

### 7.2 新增 `pricing` 表

```sql
CREATE TABLE IF NOT EXISTS pricing (
  model              TEXT PRIMARY KEY,
  prompt_per_1k      REAL NOT NULL,
  completion_per_1k  REAL NOT NULL,
  updated_at         TEXT NOT NULL
);
```

### 7.3 新增 `alert_rules` 表

```sql
CREATE TABLE IF NOT EXISTS alert_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  metric       TEXT NOT NULL,        -- error_rate | request_cost | daily_cost | latency_ms
  operator     TEXT NOT NULL,        -- gt | lt
  threshold    REAL NOT NULL,
  window_min   INTEGER DEFAULT 10,   -- 时间窗口（分钟）
  action       TEXT NOT NULL,        -- telegram | banner | both
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL
);
```

### 7.4 新增 `alert_triggers` 表

```sql
CREATE TABLE IF NOT EXISTS alert_triggers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id      INTEGER NOT NULL,
  triggered_at TEXT NOT NULL,
  actual_value REAL NOT NULL,
  context      TEXT,                 -- JSON: 触发时的上下文
  acknowledged INTEGER DEFAULT 0
);
```

### 7.5 新增 `providers` 表

```sql
CREATE TABLE IF NOT EXISTS providers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,           -- 显示名："OpenAI Official"
  base_url          TEXT NOT NULL,                  -- "https://api.openai.com/v1"
  api_key           TEXT NOT NULL,                  -- 该 Provider 的 API key（直接存，依赖 D1 访问控制）
  priority          INTEGER NOT NULL DEFAULT 100,   -- 模型冲突时小者胜出
  enabled           INTEGER NOT NULL DEFAULT 1,     -- 是否参与路由
  models            TEXT DEFAULT '[]',              -- JSON 数组，最近一次探测发现的模型 ID 列表
  health_status     TEXT DEFAULT 'unknown',         -- unknown | healthy | degraded | unhealthy
  last_latency_ms   INTEGER,
  last_checked_at   TEXT,                           -- ISO 时间
  last_error        TEXT,                           -- 最近一次失败的错误信息
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);
```

**配置流程：** 用户通过 `wrangler d1 execute losfurina-logs --command "INSERT INTO providers ..."` 直接管理。Dashboard 仅展示，不提供编辑 UI。

### 7.6 新增 `provider_health_logs` 表

```sql
CREATE TABLE IF NOT EXISTS provider_health_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL,
  checked_at   TEXT NOT NULL,
  status       TEXT NOT NULL,        -- healthy | degraded | unhealthy
  latency_ms   INTEGER,
  http_status  INTEGER,              -- 探测响应的 HTTP 状态码
  model_count  INTEGER,              -- 探测返回的模型数量
  error        TEXT                  -- 失败时的错误描述
);

CREATE INDEX IF NOT EXISTS idx_health_provider_time ON provider_health_logs(provider_id, checked_at);
```

保留策略：每个 Provider 保留最近 7 天的探测记录，更早的通过定期清理（Cron 同时执行）删除。

## 8. 告警系统

### 8.1 告警规则评估

每次写入 `logs` 后，异步评估告警规则（通过 `ctx.waitUntil`）：

```
插入 log 完成
  ↓
查询启用的 alert_rules
  ↓
对每条规则：
  ├── error_rate: 最近 N 分钟 5xx 占比
  ├── request_cost: 本条 cost_usd
  ├── daily_cost: 今日累计 cost_usd
  └── latency_ms: 本条 duration_ms
  ↓
若满足阈值：
  ├── 写入 alert_triggers
  ├── 若 action 包含 telegram → 推送
  └── 若 action 包含 banner → 写入特殊标记（前端 30s 轮询拉取）
```

### 8.2 防抖

同一规则 5 分钟内只触发一次（防止刷屏）。

### 8.3 前端 Banner

- 页面顶部固定红色横条
- 显示规则名 + 触发值 + "查看详情"链接
- "已知悉"按钮调用 `PUT /api/admin/alerts/triggered/:id/ack`

## 9. Provider 健康探测与路由

### 9.1 Cron Trigger 配置

`wrangler.toml` 增加：

```toml
[triggers]
crons = ["*/5 * * * *"]   # 每 5 分钟探测一次
```

Worker 入口模块导出 `scheduled` 处理器：

```javascript
export default {
  async fetch(request, env, ctx) { ... },
  async scheduled(event, env, ctx) {
    await probeAllProviders(env, ctx);
    await purgeOldHealthLogs(env);
  }
}
```

### 9.2 探测流程

```
1. SELECT * FROM providers WHERE enabled = 1
2. 对每个 Provider 并发执行（Promise.all）：
   a. fetch(provider.base_url + '/models',
            { headers: { Authorization: 'Bearer ' + provider.api_key },
              signal: AbortSignal.timeout(10000) })
   b. 记录响应时间
   c. 解析响应 JSON，提取 data[].id 作为模型列表
   d. 判定状态：
      - 200 + 有 models → healthy
      - 200 但 models 为空 → degraded
      - 非 200 或网络错误 → unhealthy
3. 写入 provider_health_logs
4. 更新 providers 表的 health_status / last_latency_ms / last_checked_at /
   last_error / models / updated_at
```

### 9.3 状态判定细节

- 单次探测失败不直接标记 unhealthy；采用"最近 3 次有 2 次失败"作为判定窗口
- degraded：成功率在 60-95% 之间（最近 12 次探测中 = 1 小时内）
- unhealthy：成功率 < 60%

### 9.4 手动触发

`POST /api/providers/probe` 直接调用 `probeAllProviders(env, ctx)` 同步执行，便于：

- 刚改完 DB 想立刻看效果
- 怀疑被动监控有误时手动验证

### 9.5 告警联动

新增告警规则类型 `provider_unhealthy`：

- 任一 Provider 切换到 unhealthy 状态时触发
- 复用现有 alert_rules / alert_triggers 表和 Telegram 推送链路

### 9.6 路由查询性能

Provider 数量预期 < 10 个，每次代理请求一次 D1 查询可以接受。

进一步优化：在 Worker isolate 内缓存 providers 列表，TTL 30 秒（路由查询零开销，30 秒内的 Provider 配置变更有延迟，但可接受）。

## 10. 费用计算

### 10.1 计算时机

- **写入时计算并冻结**：在 `proxyRequest` 中，提取 usage 后用当前 pricing 表计算 `cost_usd`，写入 logs
- 单价变更不追溯历史日志（语义清晰：日志反映实际历史成本）

### 10.2 公式

```
cost_usd = (prompt_tokens / 1000) * prompt_per_1k
        + (completion_tokens / 1000) * completion_per_1k
```

### 10.3 默认单价种子数据

迁移脚本插入主流模型的默认单价（参考 OpenRouter 官网），用户可在 Settings 中覆盖。

## 11. 鉴权改动

### 11.1 静态资源公开

- `/` `/index.html` `/app.js` `/styles.css` 等静态资源不需鉴权（无敏感数据）
- 进入页面后客户端从 `sessionStorage` 读 token；无 token → 跳 `/login`

### 11.2 API 鉴权（不变）

所有 `/api/*` 仍验 `Authorization: Bearer {WORKER_API_KEY}`。

### 11.3 登录页

保留现有登录页，独立 `/login` 路由，不引入到 SPA。

## 12. 性能与可观测性

### 12.1 D1 查询性能

- 查询 logs 默认 LIMIT 100，配 `cursor` 游标分页
- 全文搜索使用 LIKE，索引覆盖到 `timestamp`、`model`、`status`、`cost_usd`
- 时序聚合查询使用 `strftime` 按小时/天分组

### 12.2 前端性能

- SPA 首屏 < 100KB（不含 uPlot CDN）
- 列表虚拟滚动（自实现简易版，超 200 条时启用）
- 实时流：30 秒轮询 `/api/logs?since=`（不使用 WebSocket，Worker 限制）
- 告警 banner：与日志轮询合并到一个 `/api/poll?since=` 端点，一次返回新日志 + 未确认告警，减少请求数

### 12.3 错误兜底

- API 失败 → toast 提示 + 表格内骨架占位
- 401 → 清除 token，跳 /login
- 网络断开 → 顶部黄条提示，恢复后自动重连

## 13. 实施分阶段

为了让实现可控，分阶段交付：

**阶段 1：基础设施 + Logs 增强**
- 拆分 Worker 路由到 routes/
- 配置 Static Assets，建立 public/ 框架
- 实现 Sidebar + 主布局 + 路由
- Logs 页面（含搜索、过滤、详情面板）

**阶段 2：Overview + Analytics**
- 新增 timeseries API
- Overview 页面（KPI + 趋势图）
- Analytics 页面（费用图表 + 明细表）
- 引入 uPlot

**阶段 3：多 Provider 路由 + Health 页面**
- 新增 `providers` 和 `provider_health_logs` 表
- 改造 proxy.js：按 model 查表路由
- 改造 `/v1/models`：聚合返回
- 实现 Cron Trigger + 健康探测逻辑
- Health 页面（Provider 卡片 + 时序图 + 模型清单）
- **移除** `TARGET_URL` / `TARGET_API_KEY` 环境变量及 `src/config.js` 中的字段引用
- 提供 `migrations/seed-providers.sql.example` 帮助首次部署
- providers 表为空时 `/v1/*` 返回 503 `"no providers configured"`，Dashboard 显示引导提示

**阶段 4：Playground + Settings + 告警**
- Playground 页面（按 model 路由调用对应 Provider）
- Settings 页面（pricing / alerts）
- 告警评估逻辑 + Banner
- 新增 `provider_unhealthy` 告警类型

**阶段 5：⌘K 命令面板 + 保存视图 + 打磨**
- 命令面板实现
- localStorage 保存视图
- 微动画、过渡、空状态优化

## 14. 技术约束

- Worker 代码保持无 npm 依赖（仅 wrangler devDep）
- 前端可通过 CDN 引入 uPlot（或本地化到 `public/vendor/`）
- 数据库迁移走 `migrations/` 目录，版本化管理
- 桌面优先，min-width 1024px 起步（不做移动端响应式）

## 15. 风险与权衡

- **Static Assets 配置变化**：Cloudflare Workers 的 Assets 功能仍在演进，要锁定一个 compatibility_date
- **D1 全文搜索**：LIKE 在大量日志下性能会下降。短期可接受，长期可考虑 FTS5 虚拟表（如果 D1 支持）
- **告警评估开销**：每次写日志都评估规则会增加 D1 查询次数。通过 `ctx.waitUntil` 异步化，不影响代理延迟
- **Playground 不计费**：Playground 请求也走真实代理，会产生真实费用。需在 UI 上明确提示
- **API key 明文存储**：Provider 表的 `api_key` 字段以明文形式存储在 D1。D1 本身的访问需要 Cloudflare 账户鉴权，Worker 内部读取。可接受的妥协；若需更高安全性，未来可考虑结合 Workers 加密 KV
- **路由表缓存的一致性**：30 秒 isolate 缓存意味着新增 Provider 后最多 30 秒才会被路由识别。可以接受；手动探测按钮 + 显式刷新可缓解
- **Cron Trigger 计费**：Cloudflare 免费计划每天 1000 次 Cron 触发已远超 5 分钟探测需求（每天 288 次）。不会触及限额
- **模型冲突默默丢弃**：自动发现时如果两个 Provider 都有 `gpt-4o`，priority 高（数字小）的胜出，低优先级的会在 Health 页面以 ⚠️ 提示，但 `/v1/models` 不会暴露重复模型
