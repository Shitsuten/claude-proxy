# claude-proxy

把 `claude -p`（Claude Code CLI）包装成 Anthropic API 兼容的 HTTP endpoint。

走 Claude 订阅额度，不花 API 钱。

## 原理

```
你的应用  →  HTTP POST /v1/messages  →  claude-proxy  →  spawn claude -p  →  流式返回
```

- 接收标准 Anthropic Messages API 格式的请求（`messages` 数组 + `system` + `model`）
- 把 messages 拼成文本传给 `claude -p --output-format stream-json --include-partial-messages`
- 解析 stream-json 输出，转成 Anthropic SSE 格式（`content_block_start/delta/stop`）流回去
- 你的应用以为在调 Anthropic API，实际走的是本机 Claude Code 的订阅

## 使用

```bash
node proxy.mjs
# 默认端口 8792
```

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROXY_PORT` | `8792` | 监听端口 |
| `PROXY_AUTH_TOKEN` | 空 | 鉴权 token，为空则不鉴权 |
| `CLAUDE_CWD` | `./` | claude -p 的工作目录（会读取该目录下的 CLAUDE.md） |

## 接入方式

在你的 API 网关/客户端里，把 endpoint 指向 `http://你的IP:8792` 即可。请求格式跟 Anthropic 官方 API 完全一致。

支持流式（`stream: true`）和非流式。

## 注意

- 需要本机已登录 Claude Code（`claude /login`）
- 每次请求 spawn 一个新的 `claude -p` 进程，有几秒冷启动延迟
- 走的是你的 Max 订阅额度，不额外计费
- `claude -p` 自带工具能力（Bash/Read/Write 等），proxy 不干涉
