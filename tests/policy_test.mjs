/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 9Spokes
 *
 * Checks for the wellKnownApps policy, including the all-HTTPS wildcard.
 * Run with: node tests/policy_test.mjs
 */
import assert from "node:assert/strict";

let managed = {};
globalThis.chrome = {
    storage: {
        managed: {
            get(keys, callback) {
                callback(managed);
            },
        },
    },
};
const { PolicyManager } = await import("../src/policy.js");

async function plan(apps, grants) {
    managed = apps === undefined ? {} : { wellKnownApps: apps };
    const policy = new PolicyManager();
    await policy.load_policies();
    return policy.getPolicyUpdate(grants);
}

/* 1. a sole wildcard requests the all-HTTPS grant exactly once */
let update = await plan({ "*": true }, []);
assert.deepEqual(update.filters_to_add, ["https://*/*"]);
assert.deepEqual(update.filters_to_remove, []);
assert.equal(update.pending, true);
for (const grant of ["https://*/*", "*://*/*"]) {
    update = await plan({ "*": true }, [grant]);
    assert.equal(update.pending, false);
    assert.deepEqual(update.filters_to_remove, []);
}

/* 2. a disabled wildcard revokes every recognized broad grant */
update = await plan({ "*": false }, ["https://*/*"]);
assert.deepEqual(update.filters_to_remove, ["https://*/*"]);
assert.deepEqual(update.filters_to_add, []);
update = await plan({ "*": false }, ["https://*/*", "*://*/*"]);
assert.deepEqual(update.filters_to_remove, ["https://*/*", "*://*/*"]);

/* 3. a mixed policy is processed as an exact-site policy */
update = await plan(
    { "*": true, "denied.example": false, "allowed.example": true },
    ["https://*/*", "https://denied.example/*"],
);
assert.deepEqual(update.filters_to_remove, [
    "https://*/*",
    "https://denied.example/*",
]);
assert.deepEqual(update.filters_to_add, ["https://allowed.example/*"]);

/* 4. no policy leaves user grants alone, an empty policy strips the grant */
update = await plan(undefined, ["https://*/*"]);
assert.equal(update.pending, false);
update = await plan({}, ["https://*/*"]);
assert.deepEqual(update.filters_to_remove, ["https://*/*"]);
update = await plan({ "app.example": true }, ["https://app.example/*"]);
assert.equal(update.pending, false);

/* 5. removing the policy on a reused instance drops the managed apps */
managed = { wellKnownApps: { "*": true } };
const reused = new PolicyManager();
await reused.load_policies();
assert.equal(reused.getPolicyUpdate([]).pending, true);
managed = {};
await reused.load_policies();
assert.equal(reused.getPolicyUpdate([]).pending, false);
assert.equal(reused.getPolicyUpdate(["https://*/*"]).pending, false);
assert.equal(reused.getPolicyUpdate([]).apps_managed, null);

console.log("\nALL PASS");
