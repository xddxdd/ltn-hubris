# LTN HubRis

A Cloudflare Worker that gates Telegram group joins behind GitHub OAuth. When a
user requests to join a group, a Mini App opens inline in the join-request flow;
the user verifies their GitHub identity, the Worker checks the account's age/quality,
and only then approves the join request.

Uses the **Bot API 10.1 "Join Request Queries"** feature: the webhook returns the
`sendChatJoinRequestWebApp` call as its response body so Telegram opens the Mini App
inline in the join flow, and after GitHub verification the Worker calls
`answerChatJoinRequestQuery` to approve/decline/queue — no separate bot chat, no DM with a link.

## How it works

```
User clicks invite link → join request created (not yet a member)
   → guard bot receives ChatJoinRequest with query_id
   → bot returns the sendChatJoinRequestWebApp call (web_app_url =
     https://<worker>/miniapp) as the webhook response body — Telegram executes
     it directly, no extra API round-trip; the bot mints no token, stores nothing
   → Telegram opens the Mini App inline and injects initData (Telegram-signed,
     carrying chat_join_request_query_id, user.id, chat.id, auth_date, hash)
   → Mini App posts initData to /github/oauth; server validates the HMAC-signed initData
     (signature + freshness) and returns the GitHub authorize URL with state = initData
   → Mini App opens the GitHub authorize URL (state = initData)
   → GitHub redirects to /github/callback?code=...&state=...
   → server re-validates initData (the state), extracts chat_join_request_query_id +
     user.id, exchanges the code, fetches api.github.com/user, checks the ban flag,
     runs quality checks + dedup, and calls answerChatJoinRequestQuery(approve|decline|queue)
   → the result is shown in the browser callback page (the Mini App does not poll)
```

## Prerequisites

1. **Telegram bot** — create one via [@BotFather](https://t.me/BotFather).
2. **GitHub OAuth App** — https://github.com/settings/developers. Set the
   Authorization callback URL to `https://<your-worker-domain>/github/callback`.
   Scope used: `read:user`.
3. **Cloudflare account** with Workers + KV enabled.

## Telegram setup

1. In **@BotFather**, enable join-request-query support for the bot so
   `supports_join_request_queries` is set (BotFather → `/mybots` → your bot →
   *Bot Settings* → look for the join-request-queries toggle; if unavailable in your
   client, the assignment in step 3 will still trigger the `query_id` once the bot is
   the group's guard bot).
2. Add the bot to your **supergroup** as an administrator with the **Add Members**
   (`can_invite_users`) right. Turn on **Approve new members** for the group.
3. Assign the bot as the group's **guard bot** (group settings → *Approve new
   members* → assign the bot). Only the assigned guard bot receives a `query_id`
   and can open the Mini App; without assignment the webhook just acks the update
   (guard-bot-only deployment, no DM fallback).

## Cloudflare setup

```bash
npm install
# Create the KV namespace and paste the returned id into wrangler.toml ([[kv_namespaces]] id).
npm run kv:create

# Set secrets (production). For local dev, copy .dev.vars.example to .dev.vars.
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

The Worker derives its own public origin from each incoming request, so there is
no `BASE_URL` to configure — the Mini App URL handed to `sendChatJoinRequestWebApp`
and the GitHub `redirect_uri` are always built from whatever host Telegram or the
browser hit. Deploy behind a stable domain (your `*.workers.dev` subdomain or a
custom domain) so those URLs stay consistent across requests.

### Quality gates (wrangler.toml `[vars]`)

| Var | Default | Meaning |
|---|---|---|
| `GITHUB_MIN_AGE_DAYS` | `90` | Reject GitHub accounts younger than N days |
| `GITHUB_MIN_REPOS` | `0` | Require at least N public repos |
| `ALLOW_REUSE_GITHUB` | `false` | If `true`, one GitHub account may verify multiple Telegram users |
| `INIT_DATA_MAX_AGE_SEC` | `86400` | Max accepted age of Telegram Mini App `initData` (also the freshness window for it as the OAuth `state`) |

Beyond these gates, individual GitHub accounts can be banned: the `gh:<github_id>` KV record carries a `banned` flag, and banned accounts are declined at the callback (checked before dedup and before the idempotent re-approve path). Bans are managed by writing the KV record directly with `wrangler kv` — there is no admin endpoint.

## Deploy and wire the webhook

```bash
npm run deploy
# Point Telegram at the Worker. The webhook has no path secret: on a join request
# it only returns a sendChatJoinRequestWebApp call, which only Telegram itself
# acts on, so forged requests are harmless.
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<WORKER_URL>/webhook"
# Verify:
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

## Local development

```bash
cp .dev.vars.example .dev.vars      # fill in BOT_TOKEN, GITHUB_CLIENT_*
npm run kv:create                     # create a preview namespace, put preview_id in wrangler.toml
npm run dev                          # wrangler dev (default http://localhost:8787)
```

For local testing, expose the dev server publicly (e.g. `cloudflared tunnel --url
http://localhost:8787`) and set that URL as the webhook + GitHub callback URL.

## KV layout

Single KV namespace, prefixed keys:

| Key | Value | TTL |
|---|---|---|
| `ver:<tg_user_id>` | `{ github_id, github_login, verified_at }` | none (permanent) |
| `gh:<github_id>` | `{ tg_user_id, banned }` (dedup index + ban flag) | none (permanent) |

The join-request flow stores **no session**: Telegram's signed `initData` carries
the join-request context (chat_join_request_query_id, user.id, chat.id) and
doubles as the GitHub OAuth `state`, validated by HMAC on the way back. Returning
users re-open the Mini App; the callback recognizes an existing matching `ver:`
record and re-approves without re-running the quality/dedup checks.

## Security notes

- The Mini App's `initData` is HMAC-SHA256 validated with the bot token (server-side)
  at both `/github/oauth` and `/github/callback`, and checked for freshness, so the
  Telegram identity and join-request context are trustworthy.
- The GitHub OAuth `state` is Telegram's signed `initData` itself, so the callback is
  bound to the original join request; `hash` prevents forgery, `auth_date` +
  `INIT_DATA_MAX_AGE_SEC` prevents replay. No session is stored server-side.
- Dedup (`gh:` index) prevents one GitHub account from being reused by many Telegram
  accounts (toggle with `ALLOW_REUSE_GITHUB`).
- The `gh:<github_id>` record also carries a `banned` flag. Banned GitHub accounts
  are declined at the callback, checked before dedup and before the idempotent
  re-approve path so banning sticks for already-verified accounts. Bans are managed
  by writing the KV record directly (`wrangler kv key put --binding KV 'gh:<github_id>' '{"tg_user_id":0,"banned":true}'`); there is no admin endpoint.
- Serve the Mini App and the GitHub callback from the **same domain** (the Worker
  domain) — Bot API 10.2 hardened Mini App origins in July 2026.
- If GitHub OAuth inside the Mini App webview misbehaves on a platform, the Mini App
  opens it in the external browser via `Telegram.WebApp.openLink(url, {try_instant_view:false})`.
  The Mini App does not poll; the outcome is shown in the browser tab GitHub opened
  for OAuth, and the join request is resolved server-side on the callback.

## Files

- `src/index.ts` — Worker entry, pure router that dispatches to the handlers below. Builds a single `Config` per request via `loadConfig(env)` for the routes that need it.
- `src/common/config.ts` — raw `Env` binding types + parsed `Config` object + `loadConfig(env)`; handlers read `config.*` instead of poking env strings.
- `src/common/utils.ts` — shared response helpers (`baseUrl` derived from the request, `json`, `html`, `escapeHtml`).
- `src/common/github.ts` — GitHub OAuth exchange, `/user` fetch, quality checks (shared by `oauth/` and `callback/`).
- `src/common/initdata.ts` — Telegram Mini App `initData` HMAC validation (parses chat_join_request_query_id + chat; shared by `oauth/` and `callback/`).
- `src/common/crypto.ts` — Web Crypto HMAC-SHA256 helpers + constant-time compare.
- `src/common/html.d.ts` — ambient module declaration for `*.html` imports.
- `src/webhook/index.ts` — Telegram webhook; returns the `sendChatJoinRequestWebApp` call as the response body.
- `src/miniapp/index.ts` + `src/miniapp/miniapp.html` — the Mini App verification UI (HTML imported as a text module).
- `src/oauth/github.ts` — `/github/oauth`: validates `initData` and returns the GitHub authorize URL.
- `src/callback/github.ts` — `/github/callback`: re-validates `initData`, exchanges the code, runs quality/dedup, resolves the join request, renders the callback page.
- `src/callback/common/telegram.ts` — Bot API wrapper for `answerChatJoinRequestQuery` (shared by callback handlers).
- `src/callback/common/store.ts` — KV verification/dedup/ban helpers (shared by callback handlers).

All TypeScript that used to sit directly under `src/` (except `index.ts`) now lives in `src/common/`; `src/` root only holds the router entry and the four route subdirectories. Routes are namespaced per provider (`/github/oauth`, `/github/callback`) to leave room for additional providers under `src/oauth/` and `src/callback/` later.

## Troubleshooting

- **No Mini App opens on join:** the bot isn't assigned as the group's guard bot,
  so the update has no `query_id` and the webhook just acks it. Assign the bot in
  group settings → *Approve new members*. (There is no DM fallback; the bot must
  be the guard bot.)
- **`tg sendChatJoinRequestWebApp: Not Found`:** the method exists (Bot API 10.1+)
  but Telegram rejects it for this bot — `supports_join_request_queries` is off in
  BotFather, or no Mini App is configured. Enable both and re-check `getMe`.
- **GitHub callback `redirect_uri_mismatch`:** the callback URL in your GitHub OAuth
  App must exactly equal `https://<WORKER_URL>/github/callback`.
- **Mini App shows "invalid Telegram identity":** open the Mini App from inside
  Telegram (via the join flow), not a plain browser tab. The `initData` is only
  populated by Telegram.
