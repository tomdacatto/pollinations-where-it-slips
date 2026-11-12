import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizeUrl, readReturn } from "./pollen.js";

test("the sign-in link asks for a small budget and one day, and names the app only when there is an App Key", () => {
    const url = new URL(buildAuthorizeUrl({ redirectUri: "https://owner.github.io/tower/", state: "s1" }));
    assert.equal(url.origin + url.pathname, "https://enter.pollinations.ai/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://owner.github.io/tower/");
    assert.equal(url.searchParams.get("budget"), "0.5");
    assert.equal(url.searchParams.get("expiry"), "1");
    assert.equal(url.searchParams.has("client_id"), false);
    const named = new URL(
        buildAuthorizeUrl({ redirectUri: "https://owner.github.io/tower/", state: "s1", appKey: "pk_test123" }),
    );
    assert.equal(named.searchParams.get("client_id"), "pk_test123");
    assert.equal(url.searchParams.has("permissions"), false);
});

test("reads the key from the fragment only when the state matches", () => {
    const key = "sk_abcdefgh12345678";
    assert.deepEqual(readReturn(`#api_key=${key}&state=s1`, "s1"), { status: "ok", key });
    assert.equal(readReturn(`#api_key=${key}&state=other`, "s1").status, "bad-state");
    assert.equal(readReturn(`#api_key=${key}`, null).status, "bad-state");
    assert.equal(readReturn("#api_key=nope&state=s1", "s1").status, "bad-key");
    assert.equal(readReturn("#error=access_denied&state=s1", "s1").status, "denied");
    assert.equal(readReturn("", "s1").status, "none");
});
