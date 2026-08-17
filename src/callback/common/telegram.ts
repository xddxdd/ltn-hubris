// NOTE: the path is "bot" immediately followed by the token (no slash), then the
// method: https://api.telegram.org/bot<TOKEN>/<method>. A slash between "bot" and
// the token makes the token path invalid and Telegram returns 404 Not Found.
const API = "https://api.telegram.org/bot";

export type JoinRequestResult = "approve" | "decline" | "queue";

// Used by the GitHub OAuth callback (/auth/callback) to resolve a join request.
// That handler is not a Telegram webhook, so it can't use the webhook-reply
// pattern and makes a normal Bot API request.
async function tg(token: string, method: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; description?: string; error?: string; result?: unknown };
  if (!j.ok) {
    throw new Error(`tg ${method} HTTP ${r.status}: ${j.description ?? j.error ?? "unknown error"}`);
  }
  return j.result;
}

// Bot API 10.1: resolve the join request query (approve / decline / queue).
export function answerChatJoinRequestQuery(
  token: string,
  queryId: string,
  result: JoinRequestResult,
): Promise<unknown> {
  return tg(token, "answerChatJoinRequestQuery", {
    chat_join_request_query_id: queryId,
    result,
  });
}