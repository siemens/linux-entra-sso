/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

import { create_platform } from "./platform.js";
import { Broker } from "./broker.js";
import { ssoLog, ssoLogError } from "./utils.js";

const PLATFORM = create_platform();
let broker = null;

let CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;

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

function getBrowser() {
    let userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes("firefox")) {
        return "Firefox";
    } else if (userAgent.includes("thunderbird")) {
        return "Thunderbird";
    } else if (userAgent.includes("chrome")) {
        return "Chrome";
    } else {
        return "Unknown";
    }
}

/*
 * Check if all conditions for SSO are met
 */
function is_operational() {
    return state_active && accounts.active;
}

/*
 * Update the UI according to the current state
 */
function update_ui() {
    chrome.action.enable();
    if (is_operational()) {
        let imgdata = {};
        let icon_title = accounts.active.username;

        // shorten the title a bit
        if (getBrowser() == "Thunderbird")
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
    if (getBrowser() == "Thunderbird") title = "EntraID SSO disabled";
    chrome.action.setTitle({ title: title });
}

/*
 * Store the current state in the local storage.
 * To not leak account data in disabled state, we clear the account object.
 */
function update_storage() {
    let default_account = { ...accounts.registered[0] };
    // remove non serializable properties
    delete default_account.avatar_imgdata;
    let ssostate = {
        state: state_active,
        account: state_active ? default_account : null,
    };
    chrome.storage.local.set({ ssostate });
}

function update_handlers_firefox() {
    if (!is_operational()) {
        chrome.webRequest.onBeforeSendHeaders.removeListener(
            on_before_send_headers,
        );
        return;
    }

    chrome.webRequest.onBeforeSendHeaders.addListener(
        on_before_send_headers,
        { urls: ["https://login.microsoftonline.com/*"] },
        ["blocking", "requestHeaders"],
    );
}

function update_handlers_chrome() {
    if (!is_operational()) {
        chrome.alarms.clear("prt-sso-refresh");
        clear_net_rules();
        return;
    }
    chrome.alarms.create("prt-sso-refresh", {
        periodInMinutes: CHROME_PRT_SSO_REFRESH_INTERVAL_MIN,
    });
    chrome.alarms.onAlarm.addListener((alarm) => {
        update_net_rules(alarm);
    });
    update_net_rules();
}

function update_handlers() {
    ssoLog("update handlers");
    if (PLATFORM.isLike("Firefox")) {
        update_handlers_firefox();
    } else {
        update_handlers_chrome();
    }
}

/*
 * Update the tray icon, (un)register the handlers and notify
 * the menu about a state change.
 */
function notify_state_change(ui_only = false) {
    update_ui();
    if (!ui_only) update_handlers();
    if (port_menu === null) return;
    port_menu.postMessage({
        event: "stateChanged",
        account: accounts.registered.length > 0 ? accounts.registered[0] : null,
        broker_online: broker.isRunning(),
        enabled: state_active,
        host_version: host_versions.native,
        broker_version: host_versions.broker,
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
    ssoLog("active account: " + accounts.active.username);

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

async function on_before_send_headers(e) {
    // filter out requests that are not part of the OAuth2.0 flow
    const accept = e.requestHeaders.find(
        (header) => header.name.toLowerCase() === "accept",
    );
    if (accept === undefined || !accept.value.includes("text/html")) {
        return { requestHeaders: e.requestHeaders };
    }
    let prt = await broker.acquirePrtSsoCookie(accounts.active, e.url);
    if ("error" in prt) {
        return { requestHeaders: e.requestHeaders };
    }
    // ms-oapxbc OAuth2 protocol extension
    ssoLog("inject PRT SSO into request headers");
    e.requestHeaders.push({ name: prt.cookieName, value: prt.cookieContent });
    return { requestHeaders: e.requestHeaders };
}

async function update_net_rules(e) {
    ssoLog("update network rules");
    const SSO_URL = "https://login.microsoftonline.com";
    let prt = await broker.acquirePrtSsoCookie(accounts.active, SSO_URL);
    if ("error" in prt) {
        ssoLogError("could not acquire PRT SSO cookie: " + prt.error);
        return;
    }
    const newRules = [
        {
            id: 1,
            priority: 1,
            condition: {
                urlFilter: SSO_URL + "/*",
                resourceTypes: ["main_frame"],
            },
            action: {
                type: "modifyHeaders",
                requestHeaders: [
                    {
                        header: prt.cookieName,
                        operation: "set",
                        value: prt.cookieContent,
                    },
                ],
            },
        },
    ];
    const oldRules = await chrome.declarativeNetRequest.getSessionRules();
    const oldRuleIds = oldRules.map((rule) => rule.id);

    // Use the arrays to update the dynamic rules
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: oldRuleIds,
        addRules: newRules,
    });
    ssoLog("network rules updated");
}

async function clear_net_rules() {
    ssoLog("clear network rules");
    const oldRules = await chrome.declarativeNetRequest.getSessionRules();
    const oldRuleIds = oldRules.map((rule) => rule.id);
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: oldRuleIds,
    });
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
                accounts.active = { ...data.ssostate.account };
                ssoLog(
                    "temporarily using last-known account: " +
                        accounts.active.username,
                );
            }
            notify_state_change();
        }
    });
}

// use this API to prevent the extension from being disabled
chrome.runtime.onStartup.addListener(on_startup);

on_startup();
