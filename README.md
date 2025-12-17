# email-ai-reply

Cloudflare Email Worker：收到发到指定邮箱地址的来信后，使用 OpenAI 生成一段简短、礼貌、专业的回复，并通过 `message.reply()` 自动回信。

## 功能概览

- 解析原始 MIME 邮件（`text/plain` / `text/html` / 常见 `multipart/*`）
- 基于头部策略过滤（避免自动回复循环、群发/列表邮件等）
- 使用 OpenAI **Responses API** 生成回复（默认模型 `gpt-5.2`）
- 可选启用工具：Web Search + Python（Code Interpreter）
- 生成带 `In-Reply-To` / `References` 的回复邮件，并引用原邮件内容作为 quoted text

## 目录结构

- `worker.js`：Cloudflare Worker 入口（Email + HTTP `/health`）
- `src/core/config.js`：配置加载与默认值
- `src/ai/openai.js`：调用 OpenAI Responses API
- `src/email/parse.js`：解析邮件正文与 headers
- `src/email/guards.js`：是否应自动回复的策略
- `src/email/compose.js`：生成回复邮件的 MIME（text/html + text/plain）

## 快速开始

### 1) 安装依赖

本项目只依赖 `wrangler`（通过 `npx` 运行即可），无需额外 `npm i`。

### 2) 配置环境变量

在 Cloudflare Worker（或 `wrangler.toml` 的 `[vars]`）中设置：

- 必填：`OPENAI_API_KEY`
- 其他配置见下方“配置项”章节

### 3) 本地预览（不包含真实 Email Routing）

```bash
npx wrangler dev --local
```

然后访问：

```bash
curl http://127.0.0.1:8787/health
```

### 4) 部署

```bash
npx wrangler versions upload
```

## Cloudflare Email Routing 配置（概念说明）

本项目使用 Cloudflare 的 Email Workers 入口：

- 触发函数：`export default { async email(message, env, ctx) { ... } }`
- 需要在 Cloudflare 控制台配置 Email Routing，把目标收件地址路由到该 Worker

不同账号/域名的 Email Routing 配置界面可能略有差异；原则是：将你想自动回复的目标收件地址路由到该 Worker 处理。

## 配置项（详细）

配置来源：`wrangler.toml` 的 `[vars]` + Worker 运行时 `env`。

### OpenAI（必看）

- `OPENAI_API_KEY`（必填）

  - OpenAI API Key，用于鉴权
- `OPENAI_MODEL`（默认：`gpt-5.2`）

  - 用于 Responses API 的 `model` 字段
- `OPENAI_BASE_URL`（默认：`https://api.openai.com`）

  - 请求地址为：`POST ${OPENAI_BASE_URL}/v1/responses`
  - 便于切换代理/网关（会自动去掉末尾 `/`）
- `OPENAI_TIMEOUT_MS`（默认：`20000`）

  - OpenAI 请求超时（毫秒），超时会中断 fetch
- `MAX_COMPLETION_TOKENS`（默认：`700`）

  - Responses API 的 `max_output_tokens`
- `TEMPERATURE`（默认：`0.5`）

  - 生成温度，越大越发散

### 工具（Web Search / Python）

OpenAI 工具通过 `tools` 参数启用：

- `OPENAI_ENABLE_WEB_SEARCH`（默认：`true`）

  - 启用 `web_search_preview`
- `OPENAI_ENABLE_PYTHON`（默认：`true`）

  - 启用 `code_interpreter`

安全说明：

- 项目在 system prompt 中加入了约束：**允许搜索，但禁止把敏感邮件内容/个人信息带入搜索查询**。
- 即使开启工具，也建议你把系统提示词写得更严格，尤其在处理隐私邮件场景。

### 邮件行为与策略

- Reply 发件人地址
  - 不再通过 `FROM_ADDRESS` / `SERVICE_ADDRESS` / `MAIL_DOMAIN` 配置
  - Worker 会使用 Email Routing 路由到的收件人地址（`message.to` 的第一个地址）作为回复的 `From`
  - `Message-ID` 的域名部分会从该 `From` 地址自动推导
- `SystemPrompt`（默认：简短的专业邮件回复提示）

  - system prompt（注意大小写：当前 key 是 `SystemPrompt`）
- `ALLOW_DOMAINS`（可选，CSV）

  - 仅允许这些域的发件人触发自动回复，例如：`example.com,another.com`
- `BLOCK_DOMAINS`（可选，CSV）

  - 拒绝这些域的发件人触发自动回复

### 回复策略（避免循环/噪音）

`src/email/guards.js` 中的 `shouldReply()` 会基于常见 headers 做过滤，例如：

- `Auto-Submitted` 非 `no` 的邮件不回复
- `Precedence: bulk|junk|list` 不回复
- `List-Id` 存在不回复
- `X-Auto-Response-Suppress` 命中常见值不回复

## 邮件正文处理说明

`src/email/parse.js` 会返回：

- `text` / `htmlText`：完整正文（包含 quoted history，用于“回复里引用原文”）
- `textMain` / `htmlTextMain`：去掉长引用历史后的“主内容”（用于喂给模型，减少上下文污染）

`worker.js` 中生成 AI prompt 时会优先使用 `*Main` 字段。

## 常见问题

### 为什么本地 `node worker.js` 跑不起来？

`worker.js` 使用了 `cloudflare:email` 的运行时模块，只能在 Cloudflare Worker 环境中运行。你可以用 `wrangler dev --local` 验证 HTTP `/health`，但 Email 触发需要 Email Routing。

### Web Search 会不会泄露邮件内容？

项目在 system prompt 里做了约束，但模型/工具仍可能存在误用风险。生产环境建议：

- 默认关闭 `OPENAI_ENABLE_WEB_SEARCH`，或只在特定白名单场景开启
- 在 system prompt 里强化“不得外发敏感信息”的约束

## 许可证

未指定。
