/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

import { create_platform } from "./platform-factory.js";
import { Broker } from "./broker.js";
import { AccountManager } from "./account.js";
import { ssoLog, Deferred } from "./utils.js";
import { PolicyManager } from "./policy.js";
import { DeviceManager } from "./device.js";

const PLATFORM = create_platform();
let broker = null;
let policyManager = null;
let accountManager = null;
let deviceManager = null;

let initialized = false;
let port_menu = null;
let state_restored = false;
/* status to surface in the UI: { text, level } or null => no status */
let last_status = null;

/*
 * Resolves once we received the first broker state event from the native
 * host. This signals that the host is ready and we can load data from the
 * broker (getAccounts activates the broker on demand, so the current
 * broker state does not matter).
 */
let broker_state_received = new Deferred();

/*
 * Check if all conditions for SSO are met
 */
function is_operational() {
    return Boolean(accountManager.isActive() && accountManager.getActive());
}

/*
 * Update the status message shown in the UI. Pass null to clear it.
 * The level ("info" or "error") controls how it is rendered.
 * The "error" is also used to determine if the extension is in an error state.
 */
function report_status(text, level = "info") {
    last_status = text ? { text, level } : null;
    notify_state_change(true);
}

function is_in_error_state() {
    return !broker.isConnected() || last_status?.level === "error";
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
    chrome.action.setBadgeText({
        text: action_needed ? "1" : null,
    });
    if (is_operational()) {
        const account = accountManager.getActive();
        const imgdata = {};
        let icon_title = account.username();

        // shorten the title a bit
        icon_title = PLATFORM.transform_ui_title(icon_title);
        chrome.action.setTitle({
            title: icon_title,
        });
        for (const r of [16, 32, 48]) {
            imgdata[r] = await account.getDecoratedAvatar(r);
        }
        chrome.action.setIcon({
            imageData: imgdata,
        });
        return;
    }
    /* inactive states */
    PLATFORM.setIconDisabled();
    let title = "EntraID SSO disabled";
    if (accountManager.isActive())
        title = "EntraID SSO disabled (waiting for broker)";
    if (accountManager.hasAccounts() == 0) {
        title = "EntraID SSO disabled (no accounts registered)";
    }
    if (!broker.isConnected()) {
        title = "EntraID SSO disabled (no connection to host application)";
    }
    // We have limited space on Thunderbird, hence shorten the title
    title = PLATFORM.transform_ui_title(title);
    chrome.action.setTitle({ title: title });
}

/*
 * Update the tray icon, (un)register the handlers and notify
 * the menu about a state change.
 */
function notify_state_change(ui_only = false) {
    // on service worker startup, delay all updates until we restored
    // the application state from storage.
    if (!state_restored) return;
    const gpo_update = policyManager.getPolicyUpdate(
        PLATFORM.well_known_app_filters,
    );
    let action_needed =
        !PLATFORM.sso_url_permitted ||
        gpo_update.pending ||
        is_in_error_state();
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
    deviceManager.updateDeviceInfo(broker).then((updated) => {
        /* only notify on success to avoid indefinite recursion as errors are not cached */
        if (updated) {
            deviceManager.persist();
            notify_state_change(true);
        }
    });
    port_menu.postMessage({
        event: "stateChanged",
        accounts: accountManager.getRegistered().map((a) => a.toMenuObject()),
        nm_connected: broker.isConnected(),
        device: deviceManager.getDevice(),
        enabled: accountManager.isActive(),
        host_version: PLATFORM.host_versions.native,
        broker_version: PLATFORM.host_versions.broker,
        sso_url: PLATFORM.getSsoUrl(),
        gpo_update: gpo_update,
        status: last_status,
    });
}

async function on_message_menu(request) {
    if (request.command == "enable") {
        accountManager.setActive(true);
        const account = accountManager.selectAccount(request.username);
        if (account) ssoLog("select account " + account.username());
    } else if (request.command == "disable") {
        accountManager.setActive(false);
        accountManager.logout();
        ssoLog("disable SSO");
    }
    accountManager.persist();
    notify_state_change();
}

async function on_broker_state_change(online) {
    if (online) {
        ssoLog("DBus broker is online");
    } else {
        ssoLog("DBus broker is offline");
    }
    // unblock the initial data loading once the host reported a state.
    broker_state_received.resolve();
    notify_state_change(true);
}

async function bootstrap_from_broker() {
    // wait for the first broker state event before talking to the broker.
    await broker_state_received.promise;
    if (accountManager.hasBrokerData()) return;
    report_status("Loading data from broker\u2026", "info");
    try {
        await accountManager.loadAccounts(broker);
        accountManager.persist();
        await deviceManager.loadDeviceInfo(broker);
        deviceManager.persist();
        await PLATFORM.setup(broker);
        report_status(null);
    } catch (error) {
        report_status("Failed to load data from broker: " + error, "error");
    }
    notify_state_change();
}

async function on_storage_changed(_changes, areaName) {
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

    broker = new Broker(
        "linux_entra_sso",
        on_broker_state_change,
        PLATFORM.constructor.KEEP_BROKER_CONNECTED,
    );
    accountManager = new AccountManager(broker);
    deviceManager = new DeviceManager(accountManager);
    Promise.all([
        PLATFORM.update_host_permissions(),
        policyManager.load_policies(),
        accountManager.restore(),
        deviceManager.restore(),
        broker.restore(),
    ]).then(() => {
        state_restored = true;
        notify_state_change();
        /* asynchronously load external state */
        broker.connect();
        bootstrap_from_broker();
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
