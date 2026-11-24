/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 *
 * Checks that Chrome injects a nonce-bound SSO cookie when Entra asks for one.
 */

import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const on_request = [];
const on_updated = [];
const on_removed = [];
const on_finished = { redirect: [], completed: [], error: [] };
const alarms = new Map();
const reloads = [];
const tabReloads = [];
const tabUrls = new Map();
const tabStatuses = new Map();
const tabPendingUrls = new Map();
let recoveryDone = true;
let recoveryTabs = [];
let openTabs = [1, 2, 3, 5, 6, 7, 8];
let rejectNextNavigation = false;
let requestOnUpdate = null;
let onTabGet = null;
let onRulesGet = null;
const delayedCookies = new Map();
let rules = [];

globalThis.chrome = {
    alarms: {
        onAlarm: { addListener() {} },
        async get(name) {
            return alarms.get(name);
        },
        async create(name, options) {
            alarms.set(name, options);
        },
        async clear(name) {
            alarms.delete(name);
        },
    },
    webRequest: {
        onBeforeRequest: { addListener: (fn) => on_request.push(fn) },
        onBeforeRedirect: {
            addListener: (fn) => on_finished.redirect.push(fn),
        },
        onCompleted: { addListener: (fn) => on_finished.completed.push(fn) },
        onErrorOccurred: { addListener: (fn) => on_finished.error.push(fn) },
    },
    tabs: {
        onUpdated: { addListener: (fn) => on_updated.push(fn) },
        onRemoved: { addListener: (fn) => on_removed.push(fn) },
        async get(tabId) {
            const tab = {
                id: tabId,
                url: tabUrls.get(tabId),
                status: tabStatuses.get(tabId) ?? "complete",
                pendingUrl: tabPendingUrls.get(tabId),
            };
            const hook = onTabGet;
            onTabGet = null;
            if (hook) hook();
            return tab;
        },
        async query({ url } = {}) {
            return url ? recoveryTabs : openTabs.map((id) => ({ id }));
        },
        async update(tabId, { url }) {
            reloads.push([tabId, url]);
            const request = requestOnUpdate;
            requestOnUpdate = null;
            if (request) on_request.forEach((fn) => fn(request));
            if (rejectNextNavigation) {
                rejectNextNavigation = false;
                throw new Error("Navigation rejected.");
            }
        },
        async reload(tabId) {
            tabReloads.push(tabId);
            const request = requestOnUpdate;
            requestOnUpdate = null;
            if (request) on_request.forEach((fn) => fn(request));
            if (rejectNextNavigation) {
                rejectNextNavigation = false;
                throw new Error("Navigation rejected.");
            }
        },
    },
    declarativeNetRequest: {
        async getSessionRules() {
            const hook = onRulesGet;
            onRulesGet = null;
            if (hook) await hook();
            return rules;
        },
        async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
            rules = rules.filter((r) => !removeRuleIds.includes(r.id));
            rules.push(...addRules);
        },
    },
    storage: {
        session: {
            async get() {
                return { sso_recovery_done: recoveryDone };
            },
            async set() {
                recoveryDone = true;
            },
        },
    },
};

const acquired = [];
const broker = {
    async acquirePrtSsoCookie(account, url) {
        acquired.push(url);
        await delayedCookies.get(url);
        const nonce = URL.parse(url).searchParams.get("sso_nonce");
        return {
            cookieName: "x-ms-RefreshTokenCredential",
            cookieContent: nonce ? "nonce-" + nonce : "generic",
        };
    },
};

// platform-chrome.js imports its siblings from src/, as in the packaged extension
const root = path.join(import.meta.dirname, "..");
const dir = await mkdtemp(path.join(os.tmpdir(), "entra-sso-test-"));
await cp(path.join(root, "src"), dir, { recursive: true });
await cp(path.join(root, "platform/chrome/js"), dir, { recursive: true });
const { PlatformChrome } = await import(
    pathToFileURL(path.join(dir, "platform-chrome.js")).href
);
const { Account } = await import(
    pathToFileURL(path.join(dir, "account.js")).href
);
await rm(dir, { recursive: true, force: true });

let failures = 0;
function check(what, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(ok ? "ok  " : "FAIL", what, "=", JSON.stringify(got));
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const SIGNIN = "https://login.microsoftonline.com/common/oauth2/authorize";

// DNR urlFilter syntax: | anchors, * wildcard, ^ separator or end
function urlFilterRegExp(filter) {
    const body = filter
        .replace(/^\||\|$/g, "")
        .split("")
        .map((c) =>
            c === "*"
                ? ".*"
                : c === "^"
                  ? "([^A-Za-z0-9_.%-]|$)"
                  : c.replace(/[.+?${}()[\]\\]/, "\\$&"),
        )
        .join("");
    return new RegExp(
        (filter.startsWith("|") ? "^" : "") +
            body +
            (filter.endsWith("|") ? "$" : ""),
    );
}

// header value a sign-in request to url from this tab would carry
function header(tabId, url = SIGNIN + "?client_id=c") {
    const match = rules
        .filter(
            (r) =>
                (!r.condition.tabIds || r.condition.tabIds.includes(tabId)) &&
                urlFilterRegExp(r.condition.urlFilter).test(url),
        )
        .sort((a, b) => b.priority - a.priority)[0];
    return match?.action.requestHeaders[0].value ?? null;
}

let nextRequestId = 0;
async function navigate(tabId, url, type = "main_frame", method = "GET") {
    const requestId = String(++nextRequestId);
    tabUrls.set(tabId, url);
    on_request.forEach((fn) => fn({ requestId, tabId, url, type, method }));
    await settle();
    return requestId;
}

async function finish(requestId, outcome) {
    on_finished[outcome].forEach((fn) => fn({ requestId }));
    await settle();
}

async function updateTab(tabId, changes) {
    if ("url" in changes) tabUrls.set(tabId, changes.url);
    if (changes.status) tabStatuses.set(tabId, changes.status);
    if ("pendingUrl" in changes) {
        if (changes.pendingUrl) tabPendingUrls.set(tabId, changes.pendingUrl);
        else tabPendingUrls.delete(tabId);
    }
    on_updated.forEach((fn) =>
        fn(tabId, { status: changes.status, url: changes.url }),
    );
    await settle();
}

const platform = new PlatformChrome();

await navigate(1, SIGNIN + "?sso_nonce=n0");
check("disabled: nothing acquired", acquired, []);

platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
acquired.length = 0;

await navigate(1, SIGNIN + "?client_id=c");
check("no nonce: nothing acquired", acquired, []);
check("no nonce: generic cookie", header(1), "generic");

const nonce_url = SIGNIN + "?client_id=c&sso_nonce=n1";
await navigate(1, nonce_url);
check("nonce: acquired for exact url", acquired, [nonce_url]);
check(
    "nonce: re-request carries nonce cookie",
    header(1, nonce_url),
    "nonce-n1",
);
check("nonce: other tab keeps generic", header(2, nonce_url), "generic");
check("nonce: tab re-requested once", reloads, [[1, nonce_url]]);

await navigate(1, nonce_url);
check("same nonce: not acquired again", acquired.length, 1);
check("same nonce: not re-requested again", reloads.length, 1);

// only requests carrying a nonce get the nonce-bound cookie
check("other sign-in: generic cookie", header(1), "generic");
check(
    "follow-up: generic cookie",
    header(1, "https://login.microsoftonline.com/common/login"),
    "generic",
);
check(
    "nonce before fragment: nonce cookie",
    header(1, SIGNIN + "?sso_nonce=n1#x"),
    "nonce-n1",
);
check(
    "nonce in other parameter: generic cookie",
    header(1, SIGNIN + "?xsso_nonce=n1"),
    "generic",
);

const frame_url = SIGNIN + "?sso_nonce=n2";
await navigate(3, frame_url, "sub_frame");
check("frame: nonce cookie for its tab", header(3, frame_url), "nonce-n2");
check("frame: not re-requested", reloads.length, 1);
check("frame: first tab keeps its cookie", header(1, nonce_url), "nonce-n1");

const nonce_url3 = SIGNIN + "?client_id=c&sso_nonce=n3";
await navigate(1, nonce_url3);
check("same tab: acquired for exact url", acquired, [
    nonce_url,
    frame_url,
    nonce_url3,
]);
check("same tab: carries newest cookie", header(1, nonce_url3), "nonce-n3");
check(
    "same tab: newest cookie replaces older",
    header(1, nonce_url),
    "nonce-n3",
);
check("other tab: keeps its cookie", header(3, frame_url), "nonce-n2");

// the periodic PRT refresh must not disturb active nonce cookies
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
check(
    "refresh: keeps nonce cookies",
    [header(1, nonce_url3), header(3, frame_url)],
    ["nonce-n3", "nonce-n2"],
);

// nonce rule ids do not depend on tab ids, which may be close to 2^31
const big_tab = 2 ** 31 - 1;
openTabs.push(big_tab);
const big_url = SIGNIN + "?sso_nonce=big";
await navigate(big_tab, big_url);
const big_rule = rules.find((r) => r.condition.tabIds?.includes(big_tab));
check("large tab id: small rule id", big_rule.id < 100, true);
check("large tab id: nonce cookie", header(big_tab, big_url), "nonce-big");
reloads.pop();

// nonces of two tabs arriving at once must not share a rule id
openTabs.push(10, 11);
const url10 = SIGNIN + "?sso_nonce=n10";
const url11 = SIGNIN + "?sso_nonce=n11";
for (const [tabId, url] of [
    [10, url10],
    [11, url11],
]) {
    on_request.forEach((fn) =>
        fn({
            requestId: "c" + tabId,
            tabId,
            url,
            type: "main_frame",
            method: "GET",
        }),
    );
}
await settle();
check(
    "concurrent: both tabs carry their cookie",
    [header(10, url10), header(11, url11)],
    ["nonce-n10", "nonce-n11"],
);
reloads.length -= 2;
openTabs = openTabs.filter((id) => ![big_tab, 10, 11].includes(id));

// closed tabs lose their nonce cookie on the next sign-in request
openTabs.push(4);
const closed_url = SIGNIN + "?sso_nonce=n4";
await navigate(4, closed_url);
check("closed tab: rule added while open", header(4, closed_url), "nonce-n4");
openTabs = openTabs.filter((id) => id !== 4);
await navigate(2, SIGNIN + "?client_id=c");
check(
    "closed tab: nonce rule removed",
    rules.some((r) => r.condition.tabIds?.includes(4)),
    false,
);
check(
    "closed tab: open tab keeps its cookie",
    header(1, nonce_url3),
    "nonce-n3",
);

// a re-request rejected while the original request is pending is retried
// once that request got a response
reloads.length = 0;
const retry_url = SIGNIN + "?sso_nonce=n5";
rejectNextNavigation = true;
const retryId = await navigate(5, retry_url);
check("pending: re-request rejected", reloads, [[5, retry_url]]);
await finish(retryId, "completed");
check("pending: retried after response", reloads, [
    [5, retry_url],
    [5, retry_url],
]);
await finish(retryId, "error");
check("pending: retried only once", reloads.length, 2);

reloads.length = 0;
const redirect_url = SIGNIN + "?sso_nonce=n6";
rejectNextNavigation = true;
const redirectId = await navigate(6, redirect_url);
await finish(redirectId, "redirect");
check("pending: no retry after redirect", reloads, [[6, redirect_url]]);

// A URL navigation would turn a SAML POST into a GET and lose its body.
// Wait for the POST response, then reload its navigation entry instead.
reloads.length = 0;
const samlUrl = "https://login.microsoftonline.com/common/saml2?sso_nonce=post";
const postId = await navigate(1, samlUrl, "main_frame", "POST");
check("POST: no URL-only navigation", reloads, []);
check("POST: no reload while pending", tabReloads, []);
check("POST: nonce cookie ready", header(1, samlUrl), "nonce-post");
await finish(postId, "completed");
check("POST: reloads the committed POST", tabReloads, [1]);
await finish(postId, "completed");
check("POST: reloads only once", tabReloads, [1]);

const redirectedPostId = await navigate(
    1,
    samlUrl + "-redirect",
    "main_frame",
    "POST",
);
await finish(redirectedPostId, "redirect");
check("POST: no reload after redirect", tabReloads, [1]);

const failedPostId = await navigate(
    1,
    samlUrl + "-error",
    "main_frame",
    "POST",
);
await finish(failedPostId, "error");
check("POST: no reload after cancellation", tabReloads, [1]);

const movedPostId = await navigate(1, samlUrl + "-moved", "main_frame", "POST");
tabUrls.set(1, "https://example.com/");
await finish(movedPostId, "completed");
check("POST: no reload after leaving sign-in", tabReloads, [1]);

const rejectedPostId = await navigate(
    1,
    samlUrl + "-rejected",
    "main_frame",
    "POST",
);
rejectNextNavigation = true;
await finish(rejectedPostId, "completed");
check("POST: rejected reload attempted once", tabReloads, [1, 1]);
check("POST: never falls back to URL navigation", reloads, []);
tabReloads.length = 0;

// Network completion can precede document/subresource completion.
const loadingPostId = await navigate(
    1,
    samlUrl + "-loading",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
await finish(loadingPostId, "completed");
check("POST: waits for tab completion", tabReloads, []);
await updateTab(1, { status: "complete" });
check("POST: reloads after tab completion", tabReloads, [1]);
await updateTab(1, { status: "complete" });
check("POST: duplicate tab completion does not replay", tabReloads, [1]);
tabReloads.length = 0;

// Chrome reports the old committed URL while an SP navigation is pending.
const pendingPostId = await navigate(
    1,
    samlUrl + "-pending",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
tabPendingUrls.set(1, "https://example.com/acs");
await finish(pendingPostId, "completed");
check("POST: preserves a visible pending navigation", tabReloads, []);
await updateTab(1, {
    status: "complete",
    url: "https://example.com/acs",
    pendingUrl: null,
});
check("POST: leaves the completed SP navigation alone", tabReloads, []);

// The pending URL is omitted without host permission for its origin.
const hiddenPendingId = await navigate(
    1,
    samlUrl + "-hidden",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
await finish(hiddenPendingId, "completed");
check("POST: preserves a hidden pending navigation", tabReloads, []);
await updateTab(1, { status: "complete", url: undefined });
check("POST: hidden committed SP URL does not replay", tabReloads, []);

// A completion event can arrive while tabs.get returns an older snapshot.
const racedPostId = await navigate(
    1,
    samlUrl + "-event-race",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
onTabGet = () => {
    tabStatuses.set(1, "complete");
    on_updated.forEach((fn) => fn(1, { status: "complete" }));
};
await finish(racedPostId, "completed");
check("POST: does not miss completion during tabs.get", tabReloads, [1]);
tabReloads.length = 0;

const supersededPostId = await navigate(
    1,
    samlUrl + "-superseded",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
await finish(supersededPostId, "completed");
await navigate(1, SIGNIN + "?client_id=next");
await updateTab(1, { status: "complete" });
check("POST: a newer main-frame request invalidates retry", tabReloads, []);

const disabledPostId = await navigate(
    1,
    samlUrl + "-disable",
    "main_frame",
    "POST",
);
platform.update_request_handlers(
    false,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
await finish(disabledPostId, "completed");
check(
    "POST: disabling before network completion cancels retry",
    tabReloads,
    [],
);
check("POST: disabling clears nonce rules", rules, []);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

const deferredDisableId = await navigate(
    1,
    samlUrl + "-deferred-disable",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
await finish(deferredDisableId, "completed");
platform.update_request_handlers(
    false,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
await updateTab(1, { status: "complete" });
check(
    "POST: disabling while waiting for tab completion cancels retry",
    tabReloads,
    [],
);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

const switchedPostId = await navigate(
    1,
    samlUrl + "-switch",
    "main_frame",
    "POST",
);
platform.update_request_handlers(
    true,
    new Account({ username: "b@x" }),
    broker,
);
await settle();
await finish(switchedPostId, "completed");
check("POST: account switch cancels old retry", tabReloads, []);
check(
    "POST: account switch removes old nonce rules",
    rules.filter((r) => r.id >= 2),
    [],
);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

let resolveCookie;
const delayedUrl = samlUrl + "-delayed-cookie";
delayedCookies.set(
    delayedUrl,
    new Promise((resolve) => {
        resolveCookie = resolve;
    }),
);
const delayedPostId = await navigate(1, delayedUrl, "main_frame", "POST");
platform.update_request_handlers(
    true,
    new Account({ username: "b@x" }),
    broker,
);
await settle();
resolveCookie();
await settle();
await finish(delayedPostId, "completed");
check(
    "POST: stale broker completion cannot install nonce rules",
    rules.filter((r) => r.id >= 2),
    [],
);
check("POST: stale broker completion cannot replay", tabReloads, []);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

// Delayed acquisition for an older request must not consume the nonce of
// a newer request that will actually use the installed rule.
let resolveSharedCookie;
const sharedUrl = samlUrl + "-shared-cookie";
delayedCookies.set(
    sharedUrl,
    new Promise((resolve) => {
        resolveSharedCookie = resolve;
    }),
);
const oldSharedId = await navigate(1, sharedUrl, "main_frame", "POST");
const newSharedId = await navigate(1, sharedUrl, "main_frame", "POST");
resolveSharedCookie();
await settle();
await finish(oldSharedId, "completed");
check("POST: superseded acquisition does not replay", tabReloads, []);
await finish(newSharedId, "completed");
check("POST: newest request using the same nonce can retry", tabReloads, [1]);
tabReloads.length = 0;

// Chrome reuses requestId across redirects. Cleanup from an older callback
// must not delete the completion watcher for the next request.
let resolveRedirectCookie;
const oldRedirectUrl = samlUrl + "-old-redirect";
delayedCookies.set(
    oldRedirectUrl,
    new Promise((resolve) => {
        resolveRedirectCookie = resolve;
    }),
);
const reusedRequestId = await navigate(1, oldRedirectUrl, "main_frame", "POST");
await finish(reusedRequestId, "redirect");
const newRedirectUrl = samlUrl + "-new-redirect";
tabUrls.set(1, newRedirectUrl);
on_request.forEach((fn) =>
    fn({
        requestId: reusedRequestId,
        tabId: 1,
        url: newRedirectUrl,
        type: "main_frame",
        method: "POST",
    }),
);
await settle();
resolveRedirectCookie();
await settle();
await finish(reusedRequestId, "completed");
check(
    "POST: reused request ID keeps its newest completion watcher",
    tabReloads,
    [1],
);
tabReloads.length = 0;

const closingPostId = await navigate(
    1,
    samlUrl + "-closing",
    "main_frame",
    "POST",
);
tabStatuses.set(1, "loading");
await finish(closingPostId, "completed");
on_removed.forEach((fn) => fn(1));
await updateTab(1, { status: "complete" });
check("POST: closing a tab discards its deferred retry", tabReloads, []);

const changedDuringGetId = await navigate(
    1,
    samlUrl + "-state-race",
    "main_frame",
    "POST",
);
onTabGet = () =>
    platform.update_request_handlers(
        false,
        new Account({ username: "a@x" }),
        broker,
    );
await finish(changedDuringGetId, "completed");
check("POST: disabling during tabs.get cancels replay", tabReloads, []);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

let resolveGenericCookie;
delayedCookies.set(
    new URL(SIGNIN).origin,
    new Promise((resolve) => {
        resolveGenericCookie = resolve;
    }),
);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
platform.update_request_handlers(
    false,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
resolveGenericCookie();
await settle();
check(
    "disable: stale generic broker response cannot reinstall rules",
    rules,
    [],
);
delayedCookies.delete(new URL(SIGNIN).origin);
platform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();

platform.update_request_handlers(
    false,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
check(
    "disable: no cookie injected",
    [header(1, nonce_url3), header(3, frame_url)],
    [null, null],
);

// the missed sign-in had no SSO header, so Entra did not add a nonce yet
const recoveryUrl = SIGNIN + "?client_id=c";
const duringRecoveryUrl = SIGNIN + "?client_id=c&sso_nonce=during-recovery";
const listenerCount = on_request.length;
recoveryDone = false;
recoveryTabs = [{ id: 7, url: recoveryUrl }];
tabUrls.set(7, recoveryUrl);
acquired.length = 0;
reloads.length = 0;
const recoveryPlatform = new PlatformChrome();
check(
    "recovery: listener registered at construction",
    on_request.length,
    listenerCount + 1,
);
requestOnUpdate = {
    requestId: "recovery",
    tabId: 8,
    url: duringRecoveryUrl,
    type: "main_frame",
    method: "GET",
};
rejectNextNavigation = true;
recoveryPlatform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
check("recovery: rejected navigation handled", rejectNextNavigation, false);
check("recovery: nonce cookie acquired for exact url", acquired, [
    new URL(SIGNIN).origin,
    duringRecoveryUrl,
]);
check("recovery: handler active during tab updates", reloads, [
    [8, duringRecoveryUrl],
]);
check("recovery: reloads the original navigation entry", tabReloads, [7]);
check(
    "recovery: redirected tab carries nonce cookie",
    header(8, duringRecoveryUrl),
    "nonce-during-recovery",
);
check("recovery: missed tab uses generic cookie", header(7), "generic");
recoveryPlatform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
check(
    "recovery: listener registered only once",
    on_request.length,
    listenerCount + 1,
);

// Startup recovery cannot infer the original method from a tab URL.
// A SAML tab must reload its existing navigation entry too.
recoveryDone = false;
const recoverySamlUrl = "https://login.microsoftonline.com/common/saml2";
recoveryTabs = [{ id: 7, url: recoverySamlUrl }];
await navigate(7, recoverySamlUrl);
reloads.length = 0;
tabReloads.length = 0;
recoveryPlatform.update_request_handlers(
    true,
    new Account({ username: "a@x" }),
    broker,
);
await settle();
check("recovery: SAML tab has no URL-only navigation", reloads, []);
check("recovery: SAML navigation entry reloaded", tabReloads, [7]);

// A failed acquisition can finish before the previous generation's queued
// rule cleanup. Cleanup must leave the current error visible.
let releaseCleanup;
const cleanupWait = new Promise((resolve) => {
    releaseCleanup = resolve;
});
onRulesGet = () => cleanupWait;
const statuses = [];
recoveryPlatform.set_status_handler((message) => statuses.push(message));
const failingBroker = {
    async acquirePrtSsoCookie() {
        throw new Error("current failure");
    },
};
recoveryPlatform.update_request_handlers(
    true,
    new Account({ username: "b@x" }),
    failingBroker,
);
await settle();
check(
    "cleanup: current acquisition error is displayed",
    statuses.at(-1),
    "Failed to acquire the SSO token: Error: current failure",
);
releaseCleanup();
await settle();
check(
    "cleanup: preserves the newer acquisition error",
    statuses.at(-1),
    "Failed to acquire the SSO token: Error: current failure",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
