// KV helpers for the permanent verification + dedup records only. The
// join-request flow is stateless: Telegram-signed initData carries the
// join-request context and doubles as the GitHub OAuth `state`.

export interface Verification {
    github_id: number;
    github_login: string;
    verified_at: number;
}

export interface AccountMapping {
    tg_user_id: number;
    banned: boolean;
}

const V = (id: number) => `ver:${id}`;
const G = (id: number) => `gh:${id}`;

export async function getVerification(kv: KVNamespace, tgUserId: number): Promise<Verification | null> {
    const v = await kv.get(V(tgUserId));
    if (!v) return null;
    try {
        return JSON.parse(v) as Verification;
    } catch {
        return null;
    }
}

export async function setVerification(kv: KVNamespace, tgUserId: number, v: Verification): Promise<void> {
    await kv.put(V(tgUserId), JSON.stringify(v));
}

export async function getGithubOwner(kv: KVNamespace, githubId: number): Promise<AccountMapping | null> {
    const v = await kv.get(G(githubId));
    if (!v) return null;
    try {
        return JSON.parse(v) as AccountMapping;
    } catch {
        return null;
    }
}

export async function setGithubOwner(kv: KVNamespace, githubId: number, tgUserId: number): Promise<void> {
    await kv.put(
        G(githubId),
        JSON.stringify({
            tg_user_id: tgUserId,
            banned: false,
        } as AccountMapping),
    );
}
