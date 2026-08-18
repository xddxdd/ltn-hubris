// NOTE: the path is "bot" immediately followed by the token (no slash), then the
// method: https://api.telegram.org/bot<TOKEN>/<method>. A slash between "bot" and
// the token makes the token path invalid and Telegram returns 404 Not Found.
const API = "https://api.telegram.org/bot";

// Used by the GitHub OAuth callback to resolve a join request. The callback is
// not a Telegram webhook, so it makes a normal Bot API request.
//
// We use approveChatJoinRequest / declineChatJoinRequest (chat_id + user_id)
// rather than answerChatJoinRequestQuery, whose query_id expires quickly and
// reliably fails with "query is too old" by the time the GitHub OAuth round-trip
// completes. The chat_id and user_id are both Telegram-signed inside initData,
// so they are just as trustworthy and have no expiry tied to the query.
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

export function approveChatJoinRequest(token: string, chatId: number, userId: number): Promise<unknown> {
  return tg(token, "approveChatJoinRequest", { chat_id: chatId, user_id: userId });
}

export function declineChatJoinRequest(token: string, chatId: number, userId: number): Promise<unknown> {
  return tg(token, "declineChatJoinRequest", { chat_id: chatId, user_id: userId });
}