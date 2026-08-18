import { hmacSha256, hmacSha256Hex, safeEqual } from "./crypto";

export interface WebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface WebAppChat {
  id: number;
  type: string;
  title: string;
  username?: string;
  photo_url?: string;
}

export interface InitData {
  user?: WebAppUser;
  auth_date?: number;
  query_id?: string;
  // Bot API 10.1 join-request launch context: marks this initData as coming
  // from a join-request flow. Absent in other Mini App launch contexts. Used
  // by /github/oauth to gate the flow on a real join-request context; the
  // callback resolves the request via approveChatJoinRequest (chat_id +
  // user_id) instead, so this field is no longer consumed downstream.
  chat_join_request_query_id?: string;
  chat?: WebAppChat;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
}

export interface ValidationResult {
  ok: boolean;
  data?: InitData;
  reason?: string;
}

// Validates Telegram Mini App initData per the official algorithm:
//   secret_key        = HMAC-SHA256(key="WebAppData", message=bot_token)
//   hash              = HMAC-SHA256(key=secret_key, message=data_check_string)
//   data_check_string = "k=value\n..." for all fields except `hash`, sorted by
//                       key, using URL-decoded values.
//
// Note the secret derivation swaps the naive order: "WebAppData" is the *key*
// and the bot token is the *message* (per the Bot API docs prose, "WebAppData
// used as a key"). The data-check-string is then HMAC'd using that secret as the
// key. (Confirmed empirically against a real join-request initData payload.)
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
): Promise<ValidationResult> {
  if (!initData) return { ok: false, reason: "empty initData" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };

  params.delete("hash");
  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k) ?? ""}`).join("\n");

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate) return { ok: false, reason: "missing auth_date" };
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > maxAgeSec) return { ok: false, reason: "initData too old" };
  if (ageSec < -60) return { ok: false, reason: "initData clock skew" };

  const secret = await hmacSha256("WebAppData", botToken);
  const calc = await hmacSha256Hex(secret, dataCheckString);
  if (!safeEqual(calc, hash)) return { ok: false, reason: "bad hash" };

  const userRaw = params.get("user");
  let user: WebAppUser | undefined;
  try {
    user = userRaw ? (JSON.parse(userRaw) as WebAppUser) : undefined;
  } catch {
    return { ok: false, reason: "bad user json" };
  }

  const chatRaw = params.get("chat");
  let chat: WebAppChat | undefined;
  try {
    chat = chatRaw ? (JSON.parse(chatRaw) as WebAppChat) : undefined;
  } catch {
    return { ok: false, reason: "bad chat json" };
  }

  return {
    ok: true,
    data: {
      user,
      auth_date: authDate,
      query_id: params.get("query_id") ?? undefined,
      chat_join_request_query_id: params.get("chat_join_request_query_id") ?? undefined,
      chat,
      chat_instance: params.get("chat_instance") ?? undefined,
      chat_type: params.get("chat_type") ?? undefined,
      start_param: params.get("start_param") ?? undefined,
    },
  };
}