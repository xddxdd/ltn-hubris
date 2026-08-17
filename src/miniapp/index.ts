import { html } from "../common/utils";
import miniAppHtml from "./miniapp.html";

// Serves the Mini App verification page that Telegram opens inline in the
// join-request flow. The page itself then posts its Telegram-signed initData
// to /github/oauth to start GitHub OAuth.
export function serveMiniApp(): Response {
  return html(miniAppHtml);
}