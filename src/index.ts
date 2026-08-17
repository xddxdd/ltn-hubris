import type { Env } from "./common/config";
import { loadConfig } from "./common/config";
import { json, methodNotAllowed } from "./common/utils";
import { handleWebhook } from "./webhook";
import { serveMiniApp } from "./miniapp";
import { handleGithubOAuthBegin } from "./oauth/github";
import { handleGithubCallback } from "./callback/github";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/webhook":
          if (request.method !== "POST") return methodNotAllowed();
          return handleWebhook(request);
        case "/miniapp":
          if (request.method !== "GET") return methodNotAllowed();
          return serveMiniApp();
        case "/github/oauth":
          if (request.method !== "POST") return methodNotAllowed();
          return handleGithubOAuthBegin(request, loadConfig(env));
        case "/github/callback":
          if (request.method !== "GET") return methodNotAllowed();
          return handleGithubCallback(url, loadConfig(env));
        case "/":
          return new Response("LTN HubRis is running.\n", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (e) {
      console.error("unhandled", e);
      return json({ ok: false, error: e instanceof Error ? e.message : "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
