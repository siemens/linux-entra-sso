/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

import { create_platform } from "./platform-factory.js";
import { Broker } from "./broker.js";
import { AccountManager } from "./account.js";
import { ssoLog } from "./utils.js";
import { PolicyManager } from "./policy.js";

const PLATFORM = create_platform();
let broker = null;
let policyManager = null;
let accountManager = null;

let initialized = false;
let state_active = true;
let port_menu = null;

/*
 * Check if all conditions for SSO are met
 */
function is_operational() {
    return state_active && accountManager.getActive();
}

async function on_permissions_changed() {
    ssoLog("permissions changed, reload host_permissions");
    await PLATFORM.update_host_permissions();
    notify_state_change();
}

/*
 * Update the UI according to the current state
 */
async function update_tray(action_needed) {
    chrome.action.enable();
    if (is_operational()) {
        let account = accountManager.getActive();
        let imgdata = {};
        let icon_title = account.username();

        // shorten the title a bit
        if (PLATFORM.browser == "Thunderbird")
            icon_title = icon_title.split("@")[0];

        let color = null;
        chrome.action.setTitle({
            title: icon_title,
        });
        if (!broker.isRunning()) {
            color = "#cc0000";
        }
        for (const r of [16, 32, 48]) {
            imgdata[r] = await account.getDecoratedAvatar(color, r);
        }
        chrome.action.setIcon({
            imageData: imgdata,
        });
        chrome.action.setBadgeText({
            text: action_needed ? "1" : null,
        });
        return;
    }
    /* inactive states */
    PLATFORM.setIconDisabled();
    let title = "EntraID SSO disabled";
    if (state_active) title = "EntraID SSO disabled (waiting for broker)";
    if (accountManager.hasAccounts() == 0) {
        title = "EntraID SSO disabled (no accounts registered)";
    }
    if (!broker.isConnected()) {
        title = "EntraID SSO disabled (no connection to host application)";
        chrome.action.setBadgeText({
            text: "1",
        });
    }
    // We have limited space on Thunderbird, hence shorten the title
    if (PLATFORM.browser == "Thunderbird") title = "EntraID SSO disabled";
    chrome.action.setTitle({ title: title });
}

/*
 * Update the tray icon, (un)register the handlers and notify
 * the menu about a state change.
 */
function notify_state_change(ui_only = false) {
    const gpo_update = policyManager.getPolicyUpdate(
        PLATFORM.well_known_app_filters,
    );
    let action_needed = !PLATFORM.sso_url_permitted || gpo_update.pending;
    update_tray(action_needed);
    if (!ui_only && broker.isConnected()) {
        ssoLog("update handlers");
        PLATFORM.update_request_handlers(
            is_operational(),
            accountManager.getActive(),
            broker,
        );
    }
    if (port_menu === null) return;
    port_menu.postMessage({
        event: "stateChanged",
        accounts: accountManager.getRegistered().map((a) => a.toMenuObject()),
        broker_online: broker.isRunning(),
        nm_connected: broker.isConnected(),
        enabled: state_active,
        host_version: PLATFORM.host_versions.native,
        broker_version: PLATFORM.host_versions.broker,
        sso_url: PLATFORM.getSsoUrl(),
        gpo_update: gpo_update,
    });
}

async function on_message_menu(request) {
    if (request.command == "enable") {
        state_active = true;
        const account = accountManager.selectAccount(request.username);
        if (account) ssoLog("select account " + account.username());
    } else if (request.command == "disable") {
        state_active = false;
        accountManager.logout();
        ssoLog("disable SSO");
    }
    accountManager.persist();
    notify_state_change();
}

async function on_broker_state_change(online) {
    if (online) {
        ssoLog("connection to broker restored");
        // only reload data if we did not see the broker before
        if (!accountManager.hasBrokerData()) {
            await accountManager.loadAccounts();
            accountManager.persist();
            notify_state_change();
        }
    } else {
        ssoLog("lost connection to broker");
    }
    notify_state_change(true);
}

async function on_storage_changed(changes, areaName) {
    if (areaName == "managed") {
        await policyManager.load_policies();
    }
}

function on_startup() {
    if (initialized) {
        ssoLog("linux-entra-sso already initialized");
        return;
    }
    initialized = true;
    ssoLog("start linux-entra-sso on " + PLATFORM.browser);
    policyManager = new PolicyManager();

    chrome.storage.onChanged.addListener(on_storage_changed);
    chrome.permissions.onAdded.addListener(on_permissions_changed);
    chrome.permissions.onRemoved.addListener(on_permissions_changed);

    broker = new Broker("linux_entra_sso", on_broker_state_change);
    accountManager = new AccountManager(broker);
    Promise.all([
        PLATFORM.update_host_permissions(),
        policyManager.load_policies(),
        accountManager.restore().then((active) => {
            state_active = active;
        }),
    ]).then(() => {
        broker.connect();
        PLATFORM.setup(broker).then(() => {
            notify_state_change(true);
        });
        notify_state_change();
    });

    chrome.runtime.onConnect.addListener((port) => {
        port_menu = port;
        port_menu.onMessage.addListener(on_message_menu);
        port_menu.onDisconnect.addListener(() => {
            port_menu = null;
        });
        notify_state_change(true);
    });
}

// use this API to prevent the extension from being disabled
chrome.runtime.onStartup.addListener(on_startup);

on_startup();
