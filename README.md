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

### 同一台 VPS

如果你的 API 网关和 claude-proxy 跑在同一台机器上，直接用 localhost：

```
endpoint: http://127.0.0.1:8792
```

不需要反代、不需要 nginx、不需要域名。

### 跨服务器

如果网关在另一台机器上，需要通过 nginx 反代暴露到公网：

```nginx
location /proxy/ {
    proxy_pass http://127.0.0.1:8792/;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

然后网关的 endpoint 指向 `https://你的域名/proxy`。

请求格式跟 Anthropic 官方 API 完全一致，支持流式（`stream: true`）和非流式。

## 注意

- 需要本机已登录 Claude Code（`claude /login`）
- 每次请求 spawn 一个新的 `claude -p` 进程，有几秒冷启动延迟
- 走的是你的 Max 订阅额度，不额外计费
- `claude -p` 自带工具能力（Bash/Read/Write 等），proxy 不干涉

## 相关项目

- [claude-p-save-tokens](https://github.com/sanqianzilanyue-commits/claude-p-save-tokens) — 扒光工具省额度（约2.7万→几百token），订阅也能命中提示缓存。同一作者的省token方案
- [claude-p-thinking-stream](https://github.com/sanqianzilanyue-commits/claude-p-thinking-stream) — 把 claude -p 的思维链接进网页做成流式
