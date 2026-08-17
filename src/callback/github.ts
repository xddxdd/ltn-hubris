import type { Config } from "../common/config";
import { validateInitData } from "../common/initdata";
import * as tg from "./common/telegram";
import * as gh from "../common/github";
import * as kv from "./common/store";
import { escapeHtml, html } from "../common/utils";

// /github/callback — GitHub OAuth callback.
//
// Validates the initData carried as `state`, quality-checks the GitHub account,
// resolves the join request via answerChatJoinRequestQuery. No session storage.
//
// Error policy: the happy path throws nothing of its own — every failure bubbles
// to the single outer try/catch. Account-quality / dedup failures throw DenyError
// (deny the join request); anything else (GitHub 5xx, network blip, already-
// consumed code, KV outage, Telegram API hiccup) is treated as transient/uncertain
// and queued for admin review rather than silently declined.

// A "deny" outcome: the GitHub account itself is the problem (too new, too few
// repos, or already linked to another Telegram user). The join request is
// declined and the user is told why.
class DenyError extends Error {
  constructor(
    message: string,
    readonly login: string | null,
  ) {
    super(message);
    this.name = "DenyError";
  }
}

function logErr(label: string, e: unknown): void {
  console.error(label + ":", e instanceof Error ? e.message : String(e));
}

async function resolve(config: Config, queryId: string, result: tg.JoinRequestResult): Promise<void> {
  await tg.answerChatJoinRequestQuery(config.botToken, queryId, result);
}

export async function handleGithubCallback(url: URL, config: Config): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // the Telegram-signed initData
  const denied = url.searchParams.get("error");

  if (denied) {
    return html(resultPage("declined", "You cancelled GitHub authorization.", null));
  }
  if (!code || !state) return html(resultPage("error", "Missing code or state.", null));

  const result = await validateInitData(state, config.botToken, config.initDataMaxAgeSec);
  if (!result.ok || !result.data || !result.data.user || !result.data.chat_join_request_query_id) {
    return html(resultPage("error", "Telegram identity invalid or expired. Please request to join the group again.", null));
  }
  const queryId = result.data.chat_join_request_query_id;
  const tgUserId = result.data.user.id;

  const redirectUri = `${url.origin}/github/callback`;

  try {
    const ghToken = await gh.exchangeCode(code, config.githubClientId, config.githubClientSecret, redirectUri);
    const user = await gh.getUser(ghToken);

    // Idempotency: a matching verification record means a prior callback already
    // approved this join request (e.g. a browser refresh, since the GitHub code
    // is single-use). Re-show the approved page and re-fire the (idempotent)
    // approve call instead of re-processing.
    const existing = await kv.getVerification(config.kv, tgUserId);
    if (existing && existing.github_id === user.id) {
      await resolve(config, queryId, "approve");
      return html(resultPage("approved", undefined, user.login));
    }

    const q = gh.checkQuality(user, config.githubMinAgeDays, config.githubMinRepos);
    if (!q.ok) {
      throw new DenyError(q.reason ?? "quality check failed", user.login);
    }

    const owner = await kv.getGithubOwner(config.kv, user.id);
    if (owner !== null && owner.tg_user_id !== tgUserId && !config.allowReuseGithub) {
      throw new DenyError("This GitHub account is already linked to another Telegram user.", user.login);
    }
    if (owner !== null && owner.banned) {
      throw new DenyError("This GitHub account is banned from this service.", user.login);
    }

    await kv.setVerification(config.kv, tgUserId, {
      github_id: user.id,
      github_login: user.login,
      verified_at: Date.now(),
    });
    await kv.setGithubOwner(config.kv, user.id, tgUserId);
    await resolve(config, queryId, "approve");
    return html(resultPage("approved", undefined, user.login));
  } catch (e) {
    // Account issue → decline and tell the user why. Everything else → queue for
    // admin review (the initData state is still valid, so the user can also retry
    // from the Mini App's button). The Telegram side-effect is best-effort: if it
    // itself fails we still render the page so the user isn't left staring at a
    // blank 500.
    if (e instanceof DenyError) {
      await resolve(config, queryId, "decline").catch((err) => logErr("decline failed", err));
      return html(resultPage("declined", e.message, e.login));
    }
    const msg = e instanceof Error ? e.message : "verification failed";
    await resolve(config, queryId, "queue").catch((err) => logErr("queue failed", err));
    return html(resultPage("queued", msg, null));
  }
}

// Callback page HTML (shown in the browser Telegram opened for GitHub OAuth).
type ResultKind = "approved" | "declined" | "error" | "queued";

const RESULT_META: Record<ResultKind, { title: string; color: string; extra: string }> = {
  approved: {
    title: "Verified ✓",
    color: "#16a34a",
    extra: "<p>You can return to Telegram — the group join request has been approved.</p>",
  },
  declined: {
    title: "Not approved",
    color: "#b45309",
    extra: "<p>You can close this tab and try again from Telegram.</p>",
  },
  error: {
    title: "Something went wrong",
    color: "#dc2626",
    extra: "",
  },
  queued: {
    title: "Pending review",
    color: "#2563eb",
    extra: "<p>Your request has been queued for an admin to review. You can close this tab.</p>",
  },
};

function resultPage(kind: ResultKind, message: string | undefined, login: string | null): string {
  const meta = RESULT_META[kind];
  const who = login ? `<div class="who">GitHub: @${escapeHtml(login)}</div>` : "";
  const msg = message ? `<p class="msg">${escapeHtml(message)}</p>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
background:#f7f7f8;color:#111;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{max-width:440px;width:100%;text-align:center;background:#fff;border-radius:18px;padding:32px 24px;box-shadow:0 6px 24px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:22px;color:${meta.color}}
p{color:#6b7280;margin:0 0 12px}
.msg{color:#374151}
.who{margin-top:14px;font-size:14px;color:#6b7280}
</style></head><body><div class="card"><h1>${escapeHtml(meta.title)}</h1>${msg}${meta.extra}${who}</div></body></html>`;
}
