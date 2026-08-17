# AGENTS.md

## 项目概述

`LTN HubRis` 是部署在 Cloudflare Workers 上的 Telegram 群组守门机器人。用户申请加群时，机器人在加群流程内联打开 Mini App，要求用户用 GitHub OAuth 登录验证身份；服务端校验 GitHub 账号年龄/质量并去重，通过后才批准加群请求。

技术核心是 Bot API 10.1（2026-06）的 "Join Request Queries"：webhook 直接把 `sendChatJoinRequestWebApp` 调用作为 HTTP 响应体返回（`{"method":"sendChatJoinRequestWebApp",...}`），Telegram 端直接执行，Worker 无需再向 `api.telegram.org` 发请求。机器人需在群里被指派为 guard bot 才会收到 `query_id`；否则仅 ack 更新（guard-bot-only，无私聊回退）。

加群流程完全无服务端状态：Telegram 签名的 `initData` 在此 launch context 下自带 `chat_join_request_query_id`、`user.id`、`chat.id` 与 `auth_date`/`hash`，直接兼作 GitHub OAuth 的 `state` 透传，服务端用 `validateInitData` 验签即用。无需自签 token、无需 KV session、无需 `?s=` 参数。

## 目录结构

```
src/
  index.ts        Worker 入口、纯路由分发到下列子模块
  common/
    config.ts     Env 原始绑定类型 + Config 解析对象 + loadConfig(env)：每请求由路由构造一次 Config，后续全部从该对象读
    utils.ts       共享响应助手：baseUrl、json、html、escapeHtml、methodNotAllowed
    github.ts      GitHub OAuth 换 token、拉 /user、账号质量检查（oauth + callback 共享）
    initdata.ts    Telegram Mini App initData 的 HMAC-SHA256 校验（含 chat_join_request_query_id / chat 解析）（oauth + callback 共享）
    crypto.ts      Web Crypto HMAC-SHA256 + 常量时间比较（initdata 用）
    html.d.ts      *.html 导入的类型声明
  webhook/
    index.ts      Telegram webhook：返回 sendChatJoinRequestWebApp 调用（无需 Config）
  miniapp/
    index.ts      返回 Mini App 验证页 HTML
    miniapp.html  Mini App 验证页（作为 Text 模块导入，仅本子模块使用）
  oauth/
    github.ts     /github/oauth：校验 initData，返回 GitHub authorize URL
  callback/
    github.ts     /github/callback：再次校验 initData、换 token、质量检查、去重、resolve 加群请求
    common/
      telegram.ts Bot API 封装：answerChatJoinRequestQuery（callback 子模块共用）
      store.ts    KV 读写：verification / GitHub 去重索引（callback 子模块共用）
wrangler.toml     Workers 配置、KV 绑定、[vars]、Text 资源规则
tsconfig.json     TS 配置（strict、Bundler、noEmit）
package.json      脚本：dev / deploy / typecheck / dry-run / kv:create
.dev.vars.example 本地开发密钥模板
```

`src/` 根下除 `index.ts` 外的 TypeScript 文件已全部下沉到 `src/common/`（config、utils、github、initdata、crypto、html.d.ts）。`src/` 根只保留路由入口与四个路由子目录。单子模块专用资源在各自子目录：`miniapp.html` 在 `miniapp/`，callback 共用的 `telegram.ts` / `store.ts` 在 `callback/common/`。已移除诊断脚本 `scripts/verify_initdata.py`。

配置访问约定：路由在 `/github/oauth`、`/github/callback` 分支调用 `loadConfig(env)` 构造一个 `Config` 对象（含 botToken、githubClientId/Secret、githubMinAgeDays、githubMinRepos、allowReuseGithub、initDataMaxAgeSec、kv），传入对应 handler；handler 全程从 `config.*` 读，不再直接访问 `env.*`。webhook 与 miniapp 不需配置，因此不构造 Config。

## 运行流程

1. 用户点邀请链接 → 创建加群请求（尚未入群）。
2. 守门机器人收到 `ChatJoinRequest`（含 `query_id`，仅 guard bot 有）。webhook 把 `{"method":"sendChatJoinRequestWebApp","chat_join_request_query_id":query_id,"web_app_url":<worker>/miniapp}` 作为 HTTP 响应体返回——Telegram 直接执行，Worker 不再向 Telegram 发请求。不写任何 KV，URL 不带 `?s=`。无 query_id 时仅 ack。
3. Telegram 在加群流程内联打开 Mini App，并注入 `initData`（含 `chat_join_request_query_id`、`user`、`chat`、`auth_date`、`hash`、`signature`）。
4. Mini App 加载后 `POST /github/oauth`，body 为 `{initData}`。服务端 `validateInitData` 校验 HMAC + 新鲜度（`INIT_DATA_MAX_AGE_SEC`），确认含 `chat_join_request_query_id`，返回 GitHub authorize URL，`state` 即 `initData` 原串。
5. Mini App 用 `Telegram.WebApp.openLink(url, {try_instant_view:false})` 在外部浏览器走 GitHub OAuth。Mini App 不轮询：结果在外部浏览器的回调页展示。
6. GitHub 回调 `/github/callback?code&state=<initData>`：`validateInitData` 再次校验 `state`，取出 `chat_join_request_query_id`（queryId）与 `user.id`（tg_user_id）；换 GitHub token、拉 /user、跑质量检查 + `gh:<github_id>` 去重，写 `ver:<tg_user_id>` 与 `gh:<github_id>`，调用 `answerChatJoinRequestQuery(queryId, approve|decline)`。全程无 session 读写。

## KV 数据布局（单命名空间，前缀键）

| 键 | 值 | TTL |
|---|---|---|
| `ver:<tg_user_id>` | `{github_id, github_login, verified_at}` | 永久 |
| `gh:<github_id>` | `tg_user_id` | 永久 |

加群流程本身无 session 存储：join-request 所需状态全部在 Telegram 签名的 `initData` 里，经 Mini App 与 GitHub OAuth 透传，服务端验签即用。

## 关键配置（wrangler.toml [vars]）

- `BASE_URL`、`GROUP_CHAT_ID` 已移除：Worker 公网地址一律从入站请求动态推导（`new URL(request.url).origin`），不再可配置；如需限定单群，自行在 webhook 处加判断。
- `GITHUB_MIN_AGE_DAYS`（默认 90）、`GITHUB_MIN_REPOS`（默认 0）、`ALLOW_REUSE_GITHUB`（默认 false）。
- `INIT_DATA_MAX_AGE_SEC`（默认 86400）：`initData` 新鲜度窗口，同时覆盖 `/github/oauth` 与 `/github/callback`（`initData` 兼作 OAuth `state`，OAuth 往返通常远小于 1 天）。

密钥用 `wrangler secret put` 设置：`BOT_TOKEN`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`。

## 开发与部署

```bash
npm install
npm run kv:create        # 创建 KV，把 id 填进 wrangler.toml
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npm run typecheck         # tsc --noEmit
npm run dry-run          # wrangler deploy --dry-run
npm run deploy
# 设置 webhook：
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER>/webhook"
```

本地开发：`cp .dev.vars.example .dev.vars` 填密钥，`npm run dev`。需要公网回调时用 `cloudflared tunnel` 暴露。

## 验证清单（改动后需通过）

- `npx tsc --noEmit` 无报错。
- `npx wrangler deploy --dry-run` 成功产出 bundle 并列出 KV/vars 绑定。
- Mini App 与 GitHub 回调必须在同一域名（Bot API 10.2 的 Mini App origin 加固）。
- GitHub OAuth `state` 即完整 `initData`（URL 编码后约 1–1.5 KB），实测在 GitHub 与主流浏览器 URL 长度限制内。

## 安全注意

- 永远在服务端校验 `initData`，不可信任客户端传入的 user id。本仓库在 `/github/oauth` 与 `/github/callback` 都跑 `validateInitData`（HMAC-SHA256：secret = HMAC(key=`WebAppData`, msg=bot_token)，再 hash = HMAC(key=secret, msg=data_check_string)）+ 新鲜度检查。注意 secret 派生里 `WebAppData` 是 key、bot_token 是 msg（与 Bot API 文档措辞 「WebAppData used as a key」一致；已用真实加群 initData 实测确认）。
- GitHub `state` 即 Telegram 签名的 `initData`，回调绑定回原加群请求；`hash` 防伪造，`auth_date` + `INIT_DATA_MAX_AGE_SEC` 防重放。无服务端 session 存储。
- `gh:<github_id>` 去重防一个 GitHub 给多个 TG 账号用，`ALLOW_REUSE_GITHUB=true` 可放开。
- 回调页用 `escapeHtml` 转义所有用户/错误字符串，防 XSS。
- Webhook 无路径 secret：加群请求唯一副作用是返回 `sendChatJoinRequestWebApp` 调用，仅 Telegram 自己会执行，伪造请求无害。如需额外加固可用 `setWebhook` 的 `secret_token` header 校验（未默认启用）。
- webhook 以 HTTP 响应体返回 `sendChatJoinRequestWebApp` 调用；该方法对 bot 不可用（`supports_join_request_queries` 未启用或 BotFather 未配置 Mini App）时 Telegram 会重试 webhook，需先在 BotFather 开启。

## 依赖说明

- 仅运行时依赖 Cloudflare Workers 运行时（Web Crypto、fetch、KV），无任何 npm 运行时依赖。
- devDependencies：`wrangler`、`@cloudflare/workers-types`、`typescript`。

## 已知限制 / 后续可扩展

- 去重索引 `gh:` 与验证记录 `ver:` 都是全局的（一个 bot 实例），跨群共用。若要多群各自独立，键需带上 chat_id；当前设计假设单群部署（已移除 `GROUP_CHAT_ID` 限定，如需可自行在 webhook 加 chat_id 白名单）。
- 质量检查仅看 `created_at` 与 `public_repos`；要更强可加 followers / 提交活动 / 邮箱验证（需额外 GitHub scope）。
- `/github/callback` 的错误策略：GitHub 账号本身的问题（质量不达标、已被其他 TG 账号绑定）抛 `DenyError` → `answerChatJoinRequestQuery("decline")` 并向用户说明原因；其余异常（GitHub 5xx、网络抖动、code 已被消费、KV 故障、Telegram API 抖动等）视为瞬时/不确定 → `answerChatJoinRequestQuery("queue")` 转人工复核，而非直接拒绝。happy path 不再逐处 `.catch`，统一交外层 try/catch 处理并渲染用户可见页面。
- 已移除 auto-approve 快路径与私聊 `web_app` 按钮回退：webhook 只返回 `sendChatJoinRequestWebApp`，要求 bot 为 guard bot。返回用户重新走完 Mini App，但回调对匹配的 `ver:` 记录短路重批，不再重复质量/去重检查。
- `chat_join_request_query_id` 出现在 `initData` 是 Bot API 10.1 join-request launch context 的实测行为（官方 WebAppInitData 文档未显式记录此字段）；若 Telegram 改动此行为需重新确认。
- 路由已按 provider 拆分（`/github/oauth`、`/github/callback`），为后续新增其他身份提供者预留命名空间；对应处理代码在 `src/oauth/` 与 `src/callback/` 子目录。
