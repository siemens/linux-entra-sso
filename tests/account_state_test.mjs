/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 *
 * Round-trip checks for the SSO login state across app restarts.
 * Run with: node tests/account_state_test.mjs
 */

const store = { local: {}, session: {} };

function area(name) {
    return {
        async get(key) {
            return key in store[name] ? { [key]: store[name][key] } : {};
        },
        async set(obj) {
            Object.assign(store[name], obj);
        },
    };
}

globalThis.chrome = {
    storage: { local: area("local"), session: area("session") },
};

const { AccountManager, Account } = await import("../src/account.js");

let failures = 0;
function check(what, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(ok ? "ok  " : "FAIL", what, "=", JSON.stringify(got));
}

function reset(local = null, session = null) {
    store.local = local ? { ssostate: local } : {};
    store.session = session ? { account_manager: session } : {};
}

const acc = (username, active) => ({
    broker_obj: { name: username, username },
    active,
    avatar: null,
});

/* 1. cold start: nothing persisted => SSO active, no accounts */
reset();
let am = new AccountManager();
await am.restore();
check("cold start isActive", am.isActive(), true);
check("cold start hasAccounts", am.hasAccounts(), false);

/* 2. session restore with a selected account => logged in */
reset(null, { broker_queried: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("session selected isActive", am.isActive(), true);
check("session selected account", am.getActive()?.username(), "a@x");

/* 3. session restore, accounts but none selected => logged out */
reset(null, { broker_queried: true, accounts: [acc("a@x", false)] });
am = new AccountManager();
await am.restore();
check("session unselected isActive", am.isActive(), false);

/* 4. local restore, state active => account restored */
reset({ state: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("local active isActive", am.isActive(), true);
check("local active account", am.getActive()?.username(), "a@x");

/* 5. local restore, logged out => cached account data wiped from disk */
reset({ state: false, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("local logged-out isActive", am.isActive(), false);
check("local logged-out hasAccounts", am.hasAccounts(), false);
check("cached accounts wiped", store.local.ssostate.accounts, []);
check("logged-out marker kept", store.local.ssostate.state, false);

/* 6. round trip: logged in -> persist -> restart (session cleared) */
reset(null, { broker_queried: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
await am.persist();
store.session = {};
am = new AccountManager();
await am.restore();
check("restart logged in", am.isActive(), true);
check("restart account", am.getActive()?.username(), "a@x");

/* 7. round trip: explicit logout -> persist -> restart */
reset(null, { broker_queried: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
am.setActive(false);
am.logout();
await am.persist();
check("logout persists no accounts", store.local.ssostate.accounts, []);
check("logout persists state", store.local.ssostate.state, false);
store.session = {};
am = new AccountManager();
await am.restore();
check("restart stays logged out", am.isActive(), false);
check("restart no accounts", am.hasAccounts(), false);

/* 8. logging back in after a logout is allowed */
am.setActive(true);
check("re-login isActive", am.isActive(), true);

/* 9. account data provenance */
reset();
am = new AccountManager();
await am.restore();
check("cold start not authoritative", am.hasBrokerData(), false);
check("cold start not provisional", am.hasProvisionalData(), false);

reset({ state: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("disk restore is provisional", am.hasProvisionalData(), true);
check("disk restore not authoritative", am.hasBrokerData(), false);

reset(null, { broker_queried: true, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("session confirmed is authoritative", am.hasBrokerData(), true);
check("session confirmed not provisional", am.hasProvisionalData(), false);

reset(null, { broker_queried: false, accounts: [acc("a@x", true)] });
am = new AccountManager();
await am.restore();
check("unconfirmed session is provisional", am.hasProvisionalData(), true);

/* 10. provisional data is replaced once the broker answers */
reset({ state: true, accounts: [acc("stale@x", true)] });
am = new AccountManager();
await am.restore();
check("before broker: stale account", am.getActive()?.username(), "stale@x");
const broker = {
    async getAccounts() {
        return [Account.fromSerial(acc("fresh@x", false))];
    },
};
am.loadProfilePicture = async () => {};
await am.loadAccounts(broker);
check("after broker: fresh account", am.getActive()?.username(), "fresh@x");
check("after broker: authoritative", am.hasBrokerData(), true);
check("after broker: not provisional", am.hasProvisionalData(), false);

/* authoritative data is not re-queried */
let queried = false;
await am.loadAccounts({
    async getAccounts() {
        queried = true;
        return [];
    },
});
check("authoritative data not re-queried", queried, false);

/* 11. an empty broker response is authoritative and drops stale data */
reset({ state: true, accounts: [acc("stale@x", true)] });
am = new AccountManager();
await am.restore();
check("stale data is provisional", am.hasProvisionalData(), true);
await am.loadAccounts({
    async getAccounts() {
        return [];
    },
});
check("empty response is authoritative", am.hasBrokerData(), true);
check("empty response drops stale data", am.hasAccounts(), false);
check("empty response not provisional", am.hasProvisionalData(), false);

/* 12. a missing response leaves the provenance undetermined */
reset({ state: true, accounts: [acc("stale@x", true)] });
am = new AccountManager();
await am.restore();
await am.loadAccounts({
    async getAccounts() {
        return null;
    },
});
check("no response is not authoritative", am.hasBrokerData(), false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
