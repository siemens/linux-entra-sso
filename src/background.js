/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

import { create_platform } from "./platform-factory.js";
import { Broker } from "./broker.js";
import { AccountManager } from "./account.js";
import { getLogger } from "./utils.js";
import { PolicyManager } from "./policy.js";
import { DeviceManager } from "./device.js";
import { AppStateMachine } from "./app-state.js";

const log = getLogger("app");

const PLATFORM = create_platform();
let broker = null;
let policyManager = null;
let accountManager = null;
let deviceManager = null;

let port_menu = null;
const app_state = new AppStateMachine();
/* status to surface in the UI: { text } or null => no status */
let last_status = null;

/*
 * Check if all conditions for SSO are met
 */
function is_operational() {
    return Boolean(
        !is_in_error_state() &&
            accountManager.isActive() &&
            accountManager.getActive(),
    );
}

/* Update the status message shown in the UI. Pass null to clear it. */
function report_status(text) {
    last_status = text ? { text } : null;
    notify_state_change(true);
}

function is_in_error_state() {
    return broker.hasConnectionError() || app_state.has_failed();
}

async function on_permissions_changed() {
    log.info("permissions changed, reload host_permissions");
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
    if (!app_state.is_restored()) return;
    const gpo_update = policyManager.getPolicyUpdate(
        PLATFORM.well_known_app_filters,
    );
    let action_needed =
        !PLATFORM.sso_url_permitted ||
        gpo_update.pending ||
        is_in_error_state();
    update_tray(action_needed);
    if (!ui_only && broker.isConnected()) {
        log.debug("update handlers");
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
        app_state: app_state.state,
    });
}

async function on_message_menu(request) {
    if (is_in_error_state()) {
        notify_state_change(true);
        return;
    }
    if (request.command == "enable") {
        accountManager.setActive(true);
        const account = accountManager.selectAccount(request.username);
        if (account) log.info("select account " + account.username());
    } else if (request.command == "disable") {
        accountManager.setActive(false);
        accountManager.logout();
    }
    accountManager.persist();
    notify_state_change();
}

async function on_broker_state_change(online) {
    if (online) {
        log.debug("DBus broker is online");
    } else {
        log.debug("DBus broker is offline");
    }
    // unblock the initial data loading once the host reported a state.
    app_state.broker_ready();
    notify_state_change(true);
}

async function bootstrap_from_broker() {
    if (!(await app_state.begin_bootstrap())) return;
    report_status("Loading data from broker\u2026");
    try {
        await accountManager.loadAccounts(broker);
        accountManager.persist();
        await deviceManager.loadDeviceInfo(broker);
        deviceManager.persist();
        await PLATFORM.setup(broker);
        app_state.bootstrap_succeeded();
        report_status(null);
    } catch (error) {
        app_state.bootstrap_failed();
        report_status("Failed to load data from broker: " + error);
    }
    notify_state_change();
}

async function on_storage_changed(_changes, areaName) {
    if (areaName == "managed") {
        await policyManager.load_policies();
    }
}

function on_startup() {
    if (!app_state.initialize()) {
        log.debug("linux-entra-sso already initialized");
        return;
    }
    log.info("start linux-entra-sso on " + PLATFORM.browser);
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
        app_state.restored();
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
        broker.connect();
        bootstrap_from_broker();
        notify_state_change(true);
    });
}

// use this API to prevent the extension from being disabled
chrome.runtime.onStartup.addListener(on_startup);

on_startup();
