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
const reloads = [];
let recoveryDone = true;
let recoveryTabs = [];
let rejectNextNavigation = false;
let requestOnUpdate = null;
let rules = [];

globalThis.chrome = {
    alarms: {
        onAlarm: { addListener() {} },
        async get() {},
        async create() {},
        async clear() {},
    },
    webRequest: {
        onBeforeRequest: { addListener: (fn) => on_request.push(fn) },
    },
    tabs: {
        async query() {
            return recoveryTabs;
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

// header value a sign-in request from this tab would carry
function header(tabId) {
    const match = rules
        .filter(
            (r) => !r.condition.tabIds || r.condition.tabIds.includes(tabId),
        )
        .sort((a, b) => b.priority - a.priority)[0];
    return match?.action.requestHeaders[0].value ?? null;
}

async function navigate(tabId, url, type = "main_frame") {
    on_request.forEach((fn) => fn({ tabId, url, type }));
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
check("nonce: tab carries nonce cookie", header(1), "nonce-n1");
check("nonce: other tab keeps generic", header(2), "generic");
check("nonce: tab re-requested once", reloads, [[1, nonce_url]]);

await navigate(1, nonce_url);
check("same nonce: not acquired again", acquired.length, 1);
check("same nonce: not re-requested again", reloads.length, 1);

await navigate(3, SIGNIN + "?sso_nonce=n2", "sub_frame");
check("frame: nonce cookie for its tab", header(3), "nonce-n2");
check("frame: not re-requested", reloads.length, 1);

platform.update_request_handlers(true, { username: "a@x" }, broker);
await settle();
check("refresh: keeps nonce cookie", header(3), "nonce-n2");

platform.update_request_handlers(false, { username: "a@x" }, broker);
await settle();
check("disable: no cookie injected", header(3), null);

const recoveryUrl = SIGNIN + "?client_id=c&sso_nonce=recovery";
const duringRecoveryUrl = SIGNIN + "?client_id=c&sso_nonce=during-recovery";
const listenerCount = on_request.length;
recoveryDone = false;
recoveryTabs = [{ id: 7, url: recoveryUrl }];
acquired.length = 0;
reloads.length = 0;
const recoveryPlatform = new PlatformChrome();
check(
    "recovery: listener registered at construction",
    on_request.length,
    listenerCount + 1,
);
requestOnUpdate = {
    tabId: 8,
    url: duringRecoveryUrl,
    type: "main_frame",
};
rejectNextNavigation = true;
recoveryPlatform.update_request_handlers(true, { username: "a@x" }, broker);
await settle();
check("recovery: rejected navigation handled", rejectNextNavigation, false);
check("recovery: nonce cookies acquired for exact urls", acquired, [
    new URL(SIGNIN).origin,
    recoveryUrl,
    duringRecoveryUrl,
]);
check("recovery: handler active during tab updates", reloads, [
    [7, recoveryUrl],
    [8, duringRecoveryUrl],
]);
check(
    "recovery: redirected tab carries nonce cookie",
    header(8),
    "nonce-during-recovery",
);
recoveryPlatform.update_request_handlers(true, { username: "a@x" }, broker);
await settle();
check(
    "recovery: listener registered only once",
    on_request.length,
    listenerCount + 1,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
