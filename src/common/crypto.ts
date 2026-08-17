const enc = new TextEncoder();

function toBytes(key: string | BufferSource): Uint8Array {
  if (typeof key === "string") return enc.encode(key);
  if (key instanceof Uint8Array) return key;
  return new Uint8Array(key as ArrayBuffer);
}

export async function hmacSha256(key: string | BufferSource, data: string): Promise<ArrayBuffer> {
  const ck = await crypto.subtle.importKey(
    "raw",
    toBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", ck, enc.encode(data));
}

export async function hmacSha256Hex(key: string | BufferSource, data: string): Promise<string> {
  const buf = await hmacSha256(key, data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string compare to avoid timing side channels on the hash check.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}