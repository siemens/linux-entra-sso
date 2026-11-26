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
const on_finished = { redirect: [], completed: [], error: [] };
const alarms = new Map();
const reloads = [];
let recoveryDone = true;
let recoveryTabs = [];
let openTabs = [1, 2, 3, 5, 6, 7, 8];
let rejectNextNavigation = false;
let requestOnUpdate = null;
let rules = [];
// tab id -> URL it shows
const tabUrls = new Map();
// promises the broker and tabs.get wait for before answering, see hold()
const gates = { broker: null, tabsGet: null };

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
        async query({ url } = {}) {
            return url ? recoveryTabs : openTabs.map((id) => ({ id }));
        },
        async get(tabId) {
            const url = tabUrls.get(tabId);
            if (gates.tabsGet) await gates.tabsGet;
            return { id: tabId, url };
        },
        async update(tabId, { url }) {
            reloads.push([tabId, url]);
            tabUrls.set(tabId, url);
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
        if (gates.broker) await gates.broker;
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
    if (type === "main_frame") tabUrls.set(tabId, url);
    on_request.forEach((fn) => fn({ requestId, tabId, url, type, method }));
    await settle();
    return requestId;
}

async function finish(requestId, outcome) {
    on_finished[outcome].forEach((fn) => fn({ requestId }));
    await settle();
}

const platform = new PlatformChrome();

await navigate(1, SIGNIN + "?sso_nonce=n0");
check("disabled: nothing acquired", acquired, []);

platform.update_request_handlers(true, { username: "a@x" }, broker);
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
platform.update_request_handlers(true, { username: "a@x" }, broker);
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
    tabUrls.set(tabId, url);
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

// Acquiring a nonce credential must not replace a SAML POST with a GET.
const postUrl = "https://login.microsoftonline.com/common/saml2?sso_nonce=post";
const retriesBeforePost = reloads.length;
const postId = await navigate(1, postUrl, "main_frame", "POST");
check("POST: credential acquired for exact URL", acquired.at(-1), postUrl);
check("POST: nonce credential installed", header(1, postUrl), "nonce-post");
check("POST: no URL-only navigation", reloads.length, retriesBeforePost);
await finish(postId, "completed");
check("POST: no retry after completion", reloads.length, retriesBeforePost);

const cancelledPostId = await navigate(
    1,
    postUrl + "-cancel",
    "main_frame",
    "POST",
);
await finish(cancelledPostId, "error");
check("POST: no retry after cancellation", reloads.length, retriesBeforePost);

/*
 * The broker may answer after the sign-in went ahead. The application then
 * already got its response and must not get a second one.
 */
const APP = "https://app.example.com/callback";
// hold back answers of gates[name] until the returned function is called
function hold(name) {
    let release;
    gates[name] = new Promise((r) => (release = r));
    return async () => {
        gates[name] = null;
        release();
        await settle();
    };
}

// the tab still reports the sign-in, only the redirect tells it went ahead
reloads.length = 0;
let release = hold("tabsGet");
const racingUrl = SIGNIN + "?sso_nonce=racing";
const racingId = await navigate(1, racingUrl);
await finish(racingId, "redirect");
await release();
check(
    "late broker: no re-request after redirect during tab lookup",
    reloads,
    [],
);

release = hold("broker");
const lateDoneUrl = SIGNIN + "?sso_nonce=late-done";
const lateDoneId = await navigate(1, lateDoneUrl);
await finish(lateDoneId, "completed");
tabUrls.set(1, APP);
await release();
check("late broker: no re-request after tab moved on", reloads, []);

release = hold("broker");
const promptUrl = SIGNIN + "?sso_nonce=prompt";
const promptId = await navigate(1, promptUrl);
await finish(promptId, "completed");
await release();
check("late broker: re-request while tab shows prompt", reloads, [
    [1, promptUrl],
]);

reloads.length = 0;
const movedUrl = SIGNIN + "?sso_nonce=moved";
rejectNextNavigation = true;
const movedId = await navigate(1, movedUrl);
tabUrls.set(1, APP);
await finish(movedId, "completed");
check("pending: no retry after tab moved on", reloads, [[1, movedUrl]]);

// Successful SAML and form_post sign-ins post their result to the application.
reloads.length = 0;
const samlUrl =
    "https://login.microsoftonline.com/common/saml2?SAMLRequest=r&sso_nonce=saml";
await navigate(1, samlUrl);
check("SAML GET: nonce cookie installed", header(1, samlUrl), "nonce-saml");
check("SAML GET: not re-requested", reloads, []);

const formPostUrl = SIGNIN + "?response_mode=form_post&sso_nonce=form-post";
await navigate(1, formPostUrl);
check("form_post: not re-requested", reloads, []);

const otherUrl = "https://login.microsoftonline.com/common/login?sso_nonce=o";
await navigate(1, otherUrl);
check("other endpoint: not re-requested", reloads, []);

platform.update_request_handlers(false, { username: "a@x" }, broker);
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
recoveryTabs = [
    { id: 7, url: recoveryUrl },
    { id: 9, url: "https://login.microsoftonline.com/common/saml2" },
    { id: 10, url: SIGNIN + "?client_id=c&response_mode=form_post" },
];
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
tabUrls.set(8, duringRecoveryUrl);
rejectNextNavigation = true;
recoveryPlatform.update_request_handlers(true, { username: "a@x" }, broker);
await settle();
check("recovery: rejected navigation handled", rejectNextNavigation, false);
check("recovery: nonce cookie acquired for exact url", acquired, [
    new URL(SIGNIN).origin,
    duringRecoveryUrl,
]);
check("recovery: handler active during tab updates", reloads, [
    [7, recoveryUrl],
    [8, duringRecoveryUrl],
]);
check(
    "recovery: redirected tab carries nonce cookie",
    header(8, duringRecoveryUrl),
    "nonce-during-recovery",
);
check("recovery: missed tab uses generic cookie", header(7), "generic");
recoveryPlatform.update_request_handlers(true, { username: "a@x" }, broker);
await settle();
check(
    "recovery: listener registered only once",
    on_request.length,
    listenerCount + 1,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
