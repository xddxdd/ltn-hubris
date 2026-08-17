// Shared response helpers used by the route handlers.

// Derive the Worker's public origin from the incoming request. No BASE_URL env:
// the request URL already reflects whatever host Telegram / the browser hit.
export function baseUrl(request: Request): string {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", { status: 405 });
}