// Bring Your Own Pollen for a static page. The visitor signs in on enter.pollinations.ai
// and is sent back here. The key comes back in the URL fragment, which the browser never
// sends to a server, and is kept in sessionStorage for this tab only.
// Flow reference: https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md
import { APP_KEY, BUDGET, EXPIRY_DAYS } from "./config.js";

const ENTER = "https://enter.pollinations.ai";
const GEN = "https://gen.pollinations.ai";
const SESSION = "pollen.session";
const PENDING = "pollen.pending";
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 120_000; // a slow model fails its own request instead of holding the run

export class PollenError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.status = status;
    }
}

// The address the app is served from, without index.html, query or fragment.
export function appUrl(href = location.href) {
    return new URL("./", href).href;
}

export function buildAuthorizeUrl({ redirectUri, state, appKey = APP_KEY }) {
    const params = new URLSearchParams({
        redirect_uri: redirectUri,
        state,
        budget: String(BUDGET),
        expiry: String(EXPIRY_DAYS),
    });
    if (appKey) params.set("client_id", appKey);
    return `${ENTER}/authorize?${params}`;
}

// Reads the legacy fragment: #api_key=sk_...&state=... or #error=access_denied.
export function readReturn(hash, expectedState) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (params.has("error")) return { status: "denied" };
    if (!params.has("api_key")) return { status: "none" };
    if (!expectedState || params.get("state") !== expectedState) return { status: "bad-state" };
    const key = params.get("api_key");
    if (!/^sk_\S{8,}$/.test(key)) return { status: "bad-key" };
    return { status: "ok", key };
}

export function getSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem(SESSION) || "null");
        if (session?.key && session.expiresAt > Date.now()) return session;
    } catch {}
    clearSession();
    return null;
}

export function clearSession() {
    try {
        sessionStorage.removeItem(SESSION);
    } catch {}
}

const randomState = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function startSignIn() {
    const state = randomState();
    sessionStorage.setItem(PENDING, JSON.stringify({ state }));
    location.assign(buildAuthorizeUrl({ redirectUri: appUrl(), state }));
}

// Call once on page load. Returns "ok", "denied", "bad-state", "bad-key", "no-storage",
// or null when the page was not opened from a sign-in.
export function completeSignIn(hash = location.hash) {
    let pending = null;
    try {
        pending = JSON.parse(sessionStorage.getItem(PENDING) || "null");
    } catch {}
    const result = readReturn(hash, pending?.state);
    if (result.status === "none") return null;
    try {
        sessionStorage.removeItem(PENDING);
    } catch {}
    // Drop the fragment so the key is not left in the address bar.
    history.replaceState(null, "", location.pathname + location.search);
    if (result.status !== "ok") return result.status;
    try {
        sessionStorage.setItem(
            SESSION,
            JSON.stringify({ key: result.key, expiresAt: Date.now() + EXPIRY_DAYS * DAY_MS }),
        );
    } catch {
        return "no-storage";
    }
    return "ok";
}

/** One chat call with the visitor's key; resolves to the reply text. A different `seed` gives an independent answer: identical requests are served from cache. */
export async function chat(model, messages, { signal, seed, temperature } = {}) {
    const session = getSession();
    if (!session) throw new PollenError("Sign in with your Pollen to continue.", 401);
    const res = await fetch(`${GEN}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.key}` },
        body: JSON.stringify({
            model,
            messages,
            ...(seed !== undefined && { seed }),
            ...(temperature !== undefined && { temperature }),
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
        const choice = (await res.json()).choices?.[0];
        if (choice?.finish_reason === "refusal") throw new PollenError(`${model} refused.`, 200);
        return choice?.message?.content ?? "";
    }
    const detail = (await res.json().catch(() => ({}))).error?.message ?? `Request failed (${res.status})`;
    if (res.status === 401) {
        clearSession();
        throw new PollenError("Your sign-in expired. Sign in again to continue.", 401);
    }
    if (res.status === 402)
        throw new PollenError("Out of Pollen, or this model needs paid Pollen. Top up at enter.pollinations.ai.", 402);
    throw new PollenError(`${model}: ${detail}`, res.status);
}

/** Embeddings of `texts` with the visitor's key, in order. */
export async function embed(model, texts, { signal } = {}) {
    const session = getSession();
    if (!session) throw new PollenError("Sign in with your Pollen to continue.", 401);
    const res = await fetch(`${GEN}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.key}` },
        body: JSON.stringify({ model, input: texts }),
        signal,
    });
    if (!res.ok) throw new PollenError(`${model}: embeddings answered ${res.status}.`, res.status);
    const body = await res.json();
    if (body.data?.length !== texts.length) throw new PollenError(`${model}: embeddings came back incomplete.`, 502);
    return body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
