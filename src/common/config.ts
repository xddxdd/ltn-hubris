// Env is the raw Cloudflare binding shape; Config is the parsed, typed object
// built once per request and shared by every handler. Handlers read from Config
// rather than poking env strings ad hoc.

export interface Env {
  // Secrets (set via wrangler secret put, or .dev.vars for local)
  BOT_TOKEN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  // Non-secret vars (wrangler.toml [vars])
  GITHUB_MIN_AGE_DAYS?: string;
  GITHUB_MIN_REPOS?: string;
  ALLOW_REUSE_GITHUB?: string;
  INIT_DATA_MAX_AGE_SEC?: string;
  // KV binding
  KV: KVNamespace;
}

export interface Config {
  botToken: string;
  githubClientId: string;
  githubClientSecret: string;
  githubMinAgeDays: number;
  githubMinRepos: number;
  allowReuseGithub: boolean;
  initDataMaxAgeSec: number;
  kv: KVNamespace;
}

function num(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(raw: string | undefined): boolean {
  return raw === "true" || raw === "1";
}

// Build the single shared Config object from the raw env. Parse once, use
// everywhere.
export function loadConfig(env: Env): Config {
  return {
    botToken: env.BOT_TOKEN,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubMinAgeDays: num(env.GITHUB_MIN_AGE_DAYS, 90),
    githubMinRepos: num(env.GITHUB_MIN_REPOS, 0),
    allowReuseGithub: bool(env.ALLOW_REUSE_GITHUB),
    initDataMaxAgeSec: num(env.INIT_DATA_MAX_AGE_SEC, 86400),
    kv: env.KV,
  };
}