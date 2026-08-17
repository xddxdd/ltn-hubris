export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  public_repos: number;
  followers: number;
  following: number;
  avatar_url: string;
  bio: string | null;
  html_url: string;
}

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

export function authorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scope = "read:user",
): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  });
  return `https://github.com/login/oauth/authorize?${p}`;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const j = (await r.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!j.access_token) {
    throw new Error(j.error_description || j.error || "no access_token returned");
  }
  return j.access_token;
}

export async function getUser(token: string): Promise<GitHubUser> {
  const r = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "LTN HubRis (lantian@lantian.pub)",
    },
  });
  if (!r.ok) throw new Error(`github /user HTTP ${r.status}`);
  return (await r.json()) as GitHubUser;
}

export function checkQuality(u: GitHubUser, minAgeDays: number, minRepos: number): QualityResult {
  const createdMs = Date.parse(u.created_at);
  if (!createdMs) return { ok: false, reason: "GitHub account has no creation date" };
  const ageDays = (Date.now() - createdMs) / 86_400_000;
  if (ageDays < minAgeDays) {
    return {
      ok: false,
      reason: `GitHub account is too new (${Math.floor(ageDays)} days old, need ${minAgeDays}).`,
    };
  }
  if (u.public_repos < minRepos) {
    return {
      ok: false,
      reason: `GitHub account has too few public repos (${u.public_repos}, need ${minRepos}).`,
    };
  }
  return { ok: true };
}
