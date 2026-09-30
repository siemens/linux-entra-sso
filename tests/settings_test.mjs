/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 *
 * Checks for the settings that gate the Microsoft Graph API queries.
 * Run with: node tests/settings_test.mjs
 */

let managed = {};
let local = {};
let fetch_calls = [];
let fetch_response = { ok: false, status: 404, statusText: "Not Found" };

globalThis.chrome = {
    storage: {
        managed: {
            get(keys, callback) {
                const data = {};
                for (const key of keys) {
                    if (key in managed) data[key] = managed[key];
                }
                callback(data);
            },
        },
        local: {
            async get(key) {
                return key in local ? { [key]: local[key] } : {};
            },
            async set(data) {
                Object.assign(local, structuredClone(data));
            },
        },
    },
};

globalThis.fetch = async (url) => {
    fetch_calls.push(url);
    return fetch_response;
};

const { PolicyManager } = await import("../src/policy.js");
const { Feature, SettingsManager } = await import("../src/settings.js");
const { AccountManager, Account } = await import("../src/account.js");
const { DeviceManager, Device } = await import("../src/device.js");

let failures = 0;
function check(what, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures++;
    console.log(ok ? "ok  " : "FAIL", what, "=", JSON.stringify(got));
}

async function policy_with(policies) {
    managed = policies;
    const policy = new PolicyManager();
    await policy.load_policies();
    return policy;
}

async function settings_with(policies, user = {}) {
    local = { settings: { ...user } };
    const settings = new SettingsManager(await policy_with(policies));
    await settings.restore();
    return settings;
}

function reset_fetch(response) {
    fetch_calls = [];
    fetch_response = response ?? { ok: false, status: 404, statusText: "n/a" };
}

const jwt = (payload) =>
    "header." +
    Buffer.from(JSON.stringify(payload)).toString("base64") +
    ".signature";

const PICTURE = Feature.PROFILE_PICTURE;
const COMPLIANCE = Feature.DEVICE_COMPLIANCE;

/* 1. nothing configured keeps both features enabled */
let settings = await settings_with({});
check("default picture", settings.isEnabled(PICTURE), true);
check("default compliance", settings.isEnabled(COMPLIANCE), true);
check("default not managed", settings.isManaged(PICTURE), false);

/* 2. the user can toggle a feature and the choice is persisted */
settings = await settings_with({});
check("user disables", await settings.set(PICTURE, false), true);
check("user choice applied", settings.isEnabled(PICTURE), false);
check("other feature unaffected", settings.isEnabled(COMPLIANCE), true);
check("choice persisted", local.settings, { loadProfilePicture: false });
check("repeated set is a no-op", await settings.set(PICTURE, false), false);
check("user re-enables", await settings.set(PICTURE, true), true);
check("re-enable applied", settings.isEnabled(PICTURE), true);

/* 3. a persisted choice survives a restart */
settings = await settings_with({}, { checkDeviceCompliance: false });
check("restored user choice", settings.isEnabled(COMPLIANCE), false);

/* 4. the managed policy overrules the user in both directions */
settings = await settings_with(
    { loadProfilePicture: false },
    { loadProfilePicture: true },
);
check("policy disables", settings.isEnabled(PICTURE), false);
check("policy is managed", settings.isManaged(PICTURE), true);
check("managed set rejected", await settings.set(PICTURE, true), false);
check("managed value kept", settings.isEnabled(PICTURE), false);

settings = await settings_with(
    { checkDeviceCompliance: true },
    { checkDeviceCompliance: false },
);
check("policy enables", settings.isEnabled(COMPLIANCE), true);
check("policy is managed", settings.isManaged(COMPLIANCE), true);

/* 5. the app filter policy still works next to the feature settings */
let policy = await policy_with({
    wellKnownApps: { "app.example.com": true },
    loadProfilePicture: false,
});
let update = policy.getPolicyUpdate([]);
check("app policy pending", update.pending, true);
check("app policy filters", update.filters_to_add, [
    "https://app.example.com/*",
]);

policy = await policy_with({});
update = policy.getPolicyUpdate([]);
check("no app policy pending", update.pending, false);
check("no app policy managed", update.apps_managed, null);

/* 6. a disabled profile picture is never queried from the Graph API */
const broker = {
    async acquireTokenSilently() {
        return { accessToken: jwt({ deviceid: "dev-1" }), expiresOn: 0 };
    },
};
const account = () =>
    Account.fromSerial({
        broker_obj: { name: "A", username: "a@x" },
        active: true,
        avatar: "data:image/png;base64,AAAA",
    });

reset_fetch();
let am = new AccountManager(
    await settings_with({}, { loadProfilePicture: false }),
);
let acc = account();
await am.loadProfilePicture(broker, acc);
check("picture disabled: no request", fetch_calls, []);
check("picture disabled: avatar dropped", acc.avatar, null);

/* 7. an enabled profile picture is queried */
reset_fetch();
am = new AccountManager(await settings_with({}));
acc = account();
await am.loadProfilePicture(broker, acc);
check("picture enabled: one request", fetch_calls.length, 1);
check(
    "picture enabled: graph url",
    fetch_calls[0],
    "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
);

/* 8. a disabled compliance check is never queried and drops cached data */
const account_manager = {
    hasAccounts: () => true,
    getRegistered: () => [{ username: () => "a@x" }],
    async getToken() {
        return jwt({ deviceid: "dev-1" });
    },
};

reset_fetch();
let dm = new DeviceManager(
    account_manager,
    await settings_with({}, { checkDeviceCompliance: false }),
);
dm.device = new Device("cached", true);
check("compliance disabled: drops cache", await dm.updateDeviceInfo({}), true);
check("compliance disabled: no device", dm.getDevice(), null);
check("compliance disabled: no request", fetch_calls, []);
/* without cached data there is nothing to report anymore */
check("compliance disabled: settled", await dm.updateDeviceInfo({}), false);
check("compliance disabled: still no request", fetch_calls, []);

/* 9. an enabled compliance check is queried */
reset_fetch({
    ok: true,
    async json() {
        return { displayName: "my-device", isCompliant: true };
    },
});
dm = new DeviceManager(account_manager, await settings_with({}));
check("compliance enabled: updated", await dm.updateDeviceInfo({}), true);
check("compliance enabled: one request", fetch_calls.length, 1);
check("compliance enabled: device name", dm.getDevice()?.name, "my-device");
check("compliance enabled: compliant", dm.getDevice()?.compliant, true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
