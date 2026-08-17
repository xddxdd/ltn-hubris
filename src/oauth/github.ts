import type { Config } from "../common/config";
import { validateInitData } from "../common/initdata";
import * as gh from "../common/github";
import { baseUrl, json } from "../common/utils";

// /github/oauth — Mini App entry point that starts GitHub OAuth.
//
// initData is Telegram-signed and carries the join-request context, so it is
// used directly as the GitHub OAuth `state`. No server-side session or token.
export async function handleGithubOAuthBegin(request: Request, config: Config): Promise<Response> {
  const body = (await request.json()) as { initData?: string };
  const initData = body.initData;
  if (!initData) return json({ ok: false, error: "missing initData" }, 400);

  const result = await validateInitData(initData, config.botToken, config.initDataMaxAgeSec);
  if (!result.ok || !result.data || !result.data.user || !result.data.chat_join_request_query_id) {
    return json(
      { ok: false, error: `invalid Telegram identity (${result.reason ?? "missing join-request context"})` },
      403,
    );
  }

  const redirectUri = `${baseUrl(request)}/github/callback`;
  // Pass Telegram's signed initData through as the OAuth state.
  const authorize = gh.authorizeUrl(config.githubClientId, redirectUri, initData);
  return json({ ok: true, authorizeUrl: authorize });
}