# LosFurina AI Provider Proxy

> ✅ 连接验证：此 README 由 pi 通过 losfurina-worker provider 编辑，确认连接正常。
> 🕐 编辑时间：2026-06-11

一个轻量级的 Cloudflare Worker AI 代理网关，提供 OpenAI 兼容的 API 接口，带日志记录和 Telegram 通知。

## 功能

- 🔁 **透明代理** — 接收 OpenAI 格式请求，转发到自定义 Claude 端点
- 🛡️ **鉴权保护** — Bearer Token 认证
- 📊 **浏览器看板** — 查看请求日志、Token 用量、响应时间
- 📨 **Telegram 通知** — 缓冲推送（5条或30秒刷新）
- 💾 **D1 持久化** — 所有请求和响应记录可查询

## 部署

### 前置条件

- [Node.js](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare 账号（D1、Workers）

### 步骤

```bash
# 克隆仓库
git clone git@github.com:LosFurina/losfurina-ai-provider.git
cd losfurina-ai-provider

# 安装依赖
npm install

# 创建 D1 数据库
npx wrangler d1 create losfurina-logs

# 初始化数据库表
npx wrangler d1 execute losfurina-logs --file=./schema.sql

# 更新 wrangler.toml 中的 database_id
```

### 环境变量

在 Cloudflare Dashboard 中设置以下变量：

| 变量 | 说明 |
|------|------|
| `WORKER_API_KEY` | 访问 Worker 的 API 密钥 |
| `TARGET_URL` | 上游 API 地址（如 `https://www.packyapi.com`） |
| `TARGET_API_KEY` | 上游 API 的认证密钥 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（可选） |
| `TELEGRAM_CHAT_ID` | Telegram 通知目标 Chat ID（可选） |

### 部署

```bash
npm run deploy
```

或推送到 GitHub 触发自动部署。

## API 端点

### `POST /v1/chat/completions`

OpenAI 兼容的聊天补全接口。

```bash
curl -X POST https://losfurina-ai-provider.liweijun0302.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer <WORKER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 256
  }'
```

### `GET /v1/models`

获取可用模型列表。

### `GET /health`

健康检查。

### `GET /login`

浏览器看板登录页（密码为 `WORKER_API_KEY`）。

### `GET /`

浏览器看板主页（需先登录）。

### `GET /api/logs`

查询日志记录。

## 模型

支持的 Claude 模型（通过上游端点提供）：

| 模型 ID | 名称 |
|---------|------|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 |
| `claude-opus-4-6` | Claude Opus 4.6 |
| `claude-opus-4-7` | Claude Opus 4.7 |
| `claude-opus-4-8` | Claude Opus 4.8 |

## 项目结构

```
src/
  index.js         # Worker 入口 & 路由 & Dashboard HTML
  auth.js          # 认证逻辑
  buffer.js        # Telegram 通知缓冲
  config.js        # 配置读取
  db.js            # D1 数据库操作
  logger.js        # 日志格式化
  telegram.js      # Telegram 消息发送
schema.sql         # D1 表结构
wrangler.toml      # Cloudflare Workers 配置
```

## 已知问题 & 解决记录

### Claude 模型工具调用失败（401）

**现象**：通过 pi 等客户端使用 `anthropic-messages` API 类型接入 Claude 模型时，工具调用返回 401。

**根因**：Anthropic SDK 在发请求时会自动附带 `x-api-key: <platformToken>` header。该 header 被透传到上游 packyapi，packyapi 用它鉴权失败（因为它是本 proxy 的 platform token，不是 packyapi 的 key）。

**修复**：proxy 在转发前主动删除 `x-api-key` header（`src/routes/proxy.js`）：

```js
headers.set('Authorization', `Bearer ${provider.api_key}`);
headers.delete('Host');
headers.delete('x-api-key'); // 防止 Anthropic SDK 附带的 x-api-key 干扰上游鉴权
```

**客户端配置**（以 pi `models.json` 为例）：

```json
{
  "api": "anthropic-messages",
  "baseUrl": "https://<your-worker>.workers.dev",
  "apiKey": "<platformToken>",
  "headers": { "Authorization": "Bearer <platformToken>" }
}
```

`apiKey` 供 SDK 内部使用，`headers.Authorization` 供 proxy 鉴权。proxy 会把 `Authorization` 替换成真正的上游 key，并删除 `x-api-key`。

---

## 技术栈

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [D1 数据库](https://developers.cloudflare.com/d1/)
- 零 npm 运行时依赖
