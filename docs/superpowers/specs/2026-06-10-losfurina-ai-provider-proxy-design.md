# LosFurina AI Provider Proxy — 设计文档

> 日期: 2026-06-10
> 状态: 已批准

## 1. 概述

一个 Cloudflare Worker，作为 AI API 统一网关代理。接收 OpenAI 兼容格式的请求，鉴权后透明透传到自定义 Provider，记录日志到 D1 数据库，通过 Telegram Bot 推送通知，并提供内置日志看板。

## 2. 系统架构

```
客户端 ──POST /v1/chat/completions──→ Worker
  ├── auth.js (验 WORKER_API_KEY)
  ├── 透传请求体到 TARGET_URL
  ├── 提取响应的 usage (token 用量)
  ├── 写入 D1 (logs 表)
  ├── logger.js → buffer.js → telegram.js (缓冲推送)
  └── 原样返回响应给客户端

客户端 ──GET / (dashboard)──→ Worker
  ├── auth.js (验 WORKER_API_KEY)
  └── dashboard.js → 返回 HTML 看板页面

客户端 ──GET /api/logs──→ Worker
  ├── auth.js (验 WORKER_API_KEY)
  └── db.js → 查询 D1 → 返回 JSON
```

### 数据流

1. **请求到达**: 客户端发起 POST 请求到 `/{endpoint}`
2. **鉴权**: 验证请求头的 `Authorization: Bearer {WORKER_API_KEY}`
3. **转发**: 透传请求体到 `TARGET_URL`，替换 `Authorization` 头为 `TARGET_API_KEY`
4. **响应处理**: 读取响应体，提取 `usage` 字段（token 用量）
5. **日志记录**:
   - 写入 D1 `logs` 表
   - 生成 Markdown 摘要 → 推入 LogBuffer 内存队列
6. **Telegram 通知**: LogBuffer 按条件（满 5 条或 30 秒）flus h → 发送 Telegram 消息
7. **返回响应**: 原样返回给客户端
8. **看板访问**: 用户访问 `/` 或 `/api/logs` 查询历史日志

## 3. 文件结构

```
src/
├── index.js          # Worker 入口：路由分发
├── auth.js           # Worker API Key 鉴权
├── config.js         # 环境变量读取
├── db.js             # D1 操作（写入、查询）
├── logger.js         # Markdown 日志格式化
├── buffer.js         # 内存缓冲队列 → Telegram 推送
├── telegram.js       # Telegram Bot API 发送
├── dashboard.js      # 前端看板 HTML 生成
└── dashboard.html    # 看板页面的 HTML/CSS/JS（内联）

wrangler.toml
package.json
```

## 4. HTTP 端点

| 路径 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/v1/chat/completions` | POST | ✅ | 透传到目标 |
| `/v1/completions` | POST | ✅ | 透传到目标 |
| `/v1/embeddings` | POST | ✅ | 透传到目标 |
| `/v1/models` | GET | ✅ | 从目标 Provider 拉取 |
| `/health` | GET | ❌ | 健康检查 |
| `/` 或 `/dashboard` | GET | ✅ | 日志看板页面 |
| `/api/logs` | GET | ✅ | 看板数据接口 |

### 鉴权规则

- `/health`: 无需鉴权
- `/v1/*` 和 `/api/*` 和 `/` 和 `/dashboard`: 需要 `Authorization: Bearer {WORKER_API_KEY}`
- 鉴权失败返回 `401 Unauthorized`

## 5. D1 数据库

### 表结构

```sql
CREATE TABLE IF NOT EXISTS logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,            -- ISO 8601
  model          TEXT NOT NULL,
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  status         INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  prompt_tokens      INTEGER DEFAULT 0,
  completion_tokens  INTEGER DEFAULT 0,
  total_tokens       INTEGER DEFAULT 0,
  request_summary    TEXT,                 -- 截断 500 字符
  response_summary   TEXT                  -- 截断 500 字符
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_model ON logs(model);
```

### D1 绑定配置（wrangler.toml）

```toml
[[d1_databases]]
binding = "DB"
database_name = "losfurina-logs"
database_id = "<创建时生成>"
```

### 前端看板需要的查询

- `GET /api/logs?hours=24`: 最近 N 小时的日志列表（分页，每页 50 条）
- `GET /api/logs/stats?hours=24`: 按模型聚合的统计（请求数、token 总数、平均耗时）
- `DELETE /api/logs?before=`(ISO时间): 清理旧日志（可选）

## 6. Telegram 日志推送

### 推送策略

- **LogBuffer** 内存队列
- **触发条件**: 队列满 5 条 或 距离上次 flush 已过 30 秒（先到先发）
- 队列为空时不发

### Markdown 消息格式

```
## 🤖 请求日志

**模型:** `gpt-4o`
**路由:** → Custom Provider

### 📥 请求摘要
```
用户消息摘要（截断 500 字符）
```

### 📤 响应摘要
```
响应内容摘要（截断 500 字符）
```

### 📊 Token 用量
| 类型 | 数量 |
|------|------|
| 🆔 Prompt | 342 |
| 💡 Completion | 1,024 |
| 📦 总计 | 1,366 |

### ⏱ 性能
- **耗时:** 1.2s
- **状态码:** 200 ✅

---
```
多条目聚合时用分隔线连接。

### 配置环境变量

```toml
TELEGRAM_BOT_TOKEN = "<你的 bot token>"
TELEGRAM_CHAT_ID = "<你的 chat id>"
```

## 7. 环境变量总表

| 变量 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `WORKER_API_KEY` | secret | ✅ | 客户端鉴权 |
| `TARGET_URL` | plain | ✅ | 目标 LLM 端点 URL |
| `TARGET_API_KEY` | secret | ✅ | 调用目标端点的密钥 |
| `TELEGRAM_BOT_TOKEN` | secret | ❌ | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | plain | ❌ | 接收日志的 Chat ID |

## 8. 部署方式

1. 代码托管到 GitHub 仓库
2. Cloudflare Dashboard → Workers & Pages → 创建 Worker
3. 配置 **Git Integration** → 关联 GitHub 仓库 + 分支
4. 设置环境变量和 D1 绑定
5. 自动部署（每次 push 到主分支触发）

## 9. 技术约束

- **纯原生 API**: 不引入 npm 依赖，全用 Cloudflare Workers 原生 API
- **无外部包**: 不依赖第三方库（除了 devDependencies 如 wrangler）
- **单一 Provider**: 代理到单一目标端点，不做多 Provider 路由
- **透传模式**: 不做格式转换，请求体原样转发

## 10. 未来可扩展方向（当前不实现）

- 多 Provider 路由（模型名匹配）
- 格式转换（Anthropic ↔ OpenAI）
- 速率限制
- 更复杂的 D1 聚合查询
- 日志定期清理（自动删除 N 天前的数据）
