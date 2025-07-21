/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

import { create_platform } from "./platform.js";
import { Broker } from "./broker.js";
import { Account } from "./account.js";
import { ssoLog } from "./utils.js";

const PLATFORM = create_platform();
let broker = null;

let accounts = {
    registered: [],
    active: null,
    queried: false,
};
let host_versions = {
    native: null,
    broker: null,
};
let initialized = false;
let graph_api_token = null;
let state_active = true;
let port_menu = null;

/*
 * Check if all conditions for SSO are met
 */
function is_operational() {
    return state_active && accounts.active;
}

/*
 * Read the host_permissions from the manifest.
 * We import them lazy, as they only get relevant on token_refresh.
 */
async function load_host_permissions() {
    await chrome.permissions
        .getAll()
        .then((p) => (PLATFORM.well_known_app_filters = p.origins));
}

async function on_permissions_changed() {
    ssoLog("permissions changed, reload host_permissions");
    await load_host_permissions();
    notify_state_change();
}

/*
 * Update the UI according to the current state
 */
function update_ui() {
    chrome.action.enable();
    if (is_operational()) {
        let imgdata = {};
        let icon_title = accounts.active.username();

        // shorten the title a bit
        if (PLATFORM.browser == "Thunderbird")
            icon_title = icon_title.split("@")[0];

        let color = null;
        chrome.action.setTitle({
            title: icon_title,
        });
        // we do not yet have the avatar image
        if (!accounts.active.avatar_imgdata) return;
        if (!broker.isRunning()) {
            color = "#cc0000";
        }
        for (const r of [16, 32, 48]) {
            imgdata[r] = decorate_avatar(
                accounts.active.avatar_imgdata,
                color,
                r,
            );
        }
        chrome.action.setIcon({
            imageData: imgdata,
        });
        return;
    }
    /* inactive states */
    PLATFORM.setIconDisabled();
    let title = "EntraID SSO disabled. Click to enable.";
    if (state_active) title = "EntraID SSO disabled (waiting for broker).";
    if (accounts.registered.length == 0) {
        title = "EntraID SSO disabled (no accounts registered).";
        if (!broker.isRunning()) chrome.action.disable();
    }
    if (!broker.isConnected()) {
        title = "EntraID SSO disabled (no connection to host application)";
    }
    // We have limited space on Thunderbird, hence shorten the title
    if (PLATFORM.browser == "Thunderbird") title = "EntraID SSO disabled";
    chrome.action.setTitle({ title: title });
}

/*
 * Store the current state in the local storage.
 * To not leak account data in disabled state, we clear the account object.
 */
function update_storage() {
    let default_account = accounts.registered[0];
    let ssostate = {
        state: state_active,
        account: state_active ? default_account.brokerObject() : null,
    };
    chrome.storage.local.set({ ssostate });
}

/*
 * Update the tray icon, (un)register the handlers and notify
 * the menu about a state change.
 */
function notify_state_change(ui_only = false) {
    update_ui();
    if (!ui_only) {
        ssoLog("update handlers");
        PLATFORM.update_request_handlers(
            is_operational(),
            accounts.active,
            broker,
        );
    }
    if (port_menu === null) return;
    port_menu.postMessage({
        event: "stateChanged",
        account:
            accounts.registered.length > 0
                ? accounts.registered[0].toMenuObject()
                : null,
        broker_online: broker.isRunning(),
        enabled: state_active,
        host_version: host_versions.native,
        broker_version: host_versions.broker,
        sso_url: PLATFORM.getSsoUrl(),
    });
}

function decorate_avatar(imgdata, color, width) {
    const sWidth = imgdata.width;
    const lineWidth = Math.min(2, width / 12);
    let buffer = new OffscreenCanvas(sWidth, sWidth);
    let ctx_buffer = buffer.getContext("2d");
    ctx_buffer.putImageData(imgdata, 0, 0);

    let canvas = new OffscreenCanvas(width, width);
    let ctx = canvas.getContext("2d");
    ctx.save();
    const img_margin = color === null ? 0 : lineWidth + 1;
    ctx.beginPath();
    ctx.arc(
        width / 2,
        width / 2,
        width / 2 - img_margin,
        0,
        Math.PI * 2,
        false,
    );
    ctx.clip();
    ctx.drawImage(
        buffer,
        0,
        0,
        sWidth,
        sWidth,
        img_margin,
        img_margin,
        width - img_margin * 2,
        width - img_margin * 2,
    );
    ctx.restore();
    if (color === null) {
        return ctx.getImageData(0, 0, width, width);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(
        width / 2,
        width / 2,
        width / 2 - Math.min(1, lineWidth / 2),
        0,
        Math.PI * 2,
        false,
    );
    ctx.stroke();
    return ctx.getImageData(0, 0, width, width);
}

async function load_icon(path, width) {
    const response = await fetch(chrome.runtime.getURL(path));
    let imgBitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: width,
        resizeHeight: width,
    });
    let canvas = new OffscreenCanvas(width, width);
    let ctx = canvas.getContext("2d");
    ctx.save();
    ctx.drawImage(imgBitmap, 0, 0);
    ctx.restore();
    return ctx.getImageData(0, 0, width, width);
}

async function load_accounts() {
    ssoLog("loading accounts");
    if (accounts.queried) return;

    const _accounts = await broker.getAccounts();
    if (!_accounts) return;
    accounts.queried = true;
    accounts.registered = _accounts;
    accounts.active = _accounts[0];
    accounts.active.avatar = null;
    accounts.active.avatar_imgdata = await load_icon(
        "/icons/profile-outline_48.png",
        48,
    );
    ssoLog("active account: " + accounts.active.username());

    // load profile picture and set it as icon
    if (!graph_api_token || graph_api_token.expiresOn < Date.now() + 60000) {
        graph_api_token = null;
        graph_api_token = await broker.acquireTokenSilently(accounts.active);
        if ("error" in graph_api_token) {
            ssoLog("couldn't acquire API token for avatar:");
            console.log(graph_api_token.error);
            return;
        }
        ssoLog("API token acquired");
    }
    const response = await fetch(
        "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
        {
            headers: {
                Accept: "image/jpeg",
                Authorization: "Bearer " + graph_api_token.accessToken,
            },
        },
    );
    if (response.ok) {
        let avatar = await createImageBitmap(await response.blob());
        let canvas = new OffscreenCanvas(48, 48);
        let ctx = canvas.getContext("2d");
        ctx.save();
        ctx.beginPath();
        ctx.arc(24, 24, 24, 0, Math.PI * 2, false);
        ctx.clip();
        ctx.drawImage(avatar, 0, 0);
        ctx.restore();
        /* serialize image to data URL (ugly, but portable) */
        let blob = await canvas.convertToBlob();
        const dataUrl = await new Promise((r) => {
            let a = new FileReader();
            a.onload = r;
            a.readAsDataURL(blob);
        }).then((e) => e.target.result);

        /* store image data */
        ctx.clearRect(0, 0, 48, 48);
        ctx.drawImage(avatar, 0, 0, 48, 48);
        accounts.active.avatar_imgdata = ctx.getImageData(0, 0, 48, 48);
        accounts.active.avatar = dataUrl;
    } else {
        ssoLog("Warning: Could not get profile picture.");
    }
    update_storage();
}

async function on_message_menu(request) {
    if (request.command == "enable") {
        state_active = true;
    } else if (request.command == "disable") {
        state_active = false;
    }
    update_storage();
    notify_state_change();
}

async function on_broker_state_change(online) {
    if (online) {
        ssoLog("connection to broker restored");
        // only reload data if we did not see the broker before
        if (accounts.queried === false) {
            await load_accounts();
            notify_state_change();
        }
        if (host_versions.native === null) {
            host_versions = await broker.getVersion();
        }
    } else {
        ssoLog("lost connection to broker");
    }
}

function on_startup() {
    if (initialized) {
        ssoLog("linux-entra-sso already initialized");
        return;
    }
    initialized = true;
    ssoLog("start linux-entra-sso on " + PLATFORM.browser);
    load_host_permissions();
    chrome.permissions.onAdded.addListener(on_permissions_changed);
    chrome.permissions.onRemoved.addListener(on_permissions_changed);
    notify_state_change(true);

    broker = new Broker("linux_entra_sso", on_broker_state_change);

    chrome.runtime.onConnect.addListener((port) => {
        port_menu = port;
        port_menu.onMessage.addListener(on_message_menu);
        notify_state_change(true);
        port_menu.onDisconnect.addListener(() => {
            port_menu = null;
        });
    });

    chrome.storage.local.get("ssostate", (data) => {
        if (data.ssostate) {
            state_active = data.ssostate.state;
            if (state_active) {
                accounts.active = new Account(data.ssostate.account);
                ssoLog(
                    "temporarily using last-known account: " +
                        accounts.active.username(),
                );
            }
            notify_state_change();
        }
    });
}

// use this API to prevent the extension from being disabled
chrome.runtime.onStartup.addListener(on_startup);

on_startup();
