// Telegram webhook: returns the sendChatJoinRequestWebApp call as the JSON
// response body; Telegram executes it directly (no extra round-trip to
// api.telegram.org). The Mini App it opens receives Telegram-signed initData
// carrying the join-request context (chat_join_request_query_id, user.id,
// chat.id), so the webhook mints no token and writes no state. No config needed.

import { baseUrl, json } from "../common/utils";

interface ChatJoinRequestUpdate {
  chat: { id: number };
  from: { id: number };
  user_chat_id: number;
  date: number;
  bio?: string;
  query_id?: string;
  invite_link?: unknown;
}

export async function handleWebhook(request: Request): Promise<Response> {
  const update = (await request.json()) as { chat_join_request?: ChatJoinRequestUpdate };
  const jr = update.chat_join_request;
  if (!jr) return json({ ok: true, ignored: true }); // only join requests handled

  // sendChatJoinRequestWebApp requires a query_id, which only the group's
  // assigned guard bot receives. Without it we just ack the update.
  const { query_id } = jr;
  if (!query_id) return json({ ok: true, ignored: "no query_id (bot is not the guard bot)" });

  const miniUrl = `${baseUrl(request)}/miniapp`;

  // Return the method call as the webhook response body. Telegram runs it.
  return json({
    method: "sendChatJoinRequestWebApp",
    chat_join_request_query_id: query_id,
    web_app_url: miniUrl,
  });
}