/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */
let CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;

let prt_sso_cookie = {
    data: {},
    hasData: false
};
let accounts = {
    registered: [],
    active: null,
    queried: false
};
let initialized = false;
let graph_api_token = null;
let state_active = true;
let broker_online = false;
let port = null;

function ssoLog(message) {
    console.log('[Linux Entra SSO] ' + message)
}

function ssoLogError(message) {
    console.error('[Linux Entra SSO] ' + message)
}

function isFirefox() {
    return typeof browser !== "undefined";
}

/*
 * Helpers to wait for a value to become available
 */
async function sleep (ms) {
    return new Promise(r => setTimeout(r, ms));
}
async function waitFor(f) {
    while(!f()) await sleep(200);
    return f();
};

async function load_accounts() {
    port.postMessage({'command': 'getAccounts'});
    await waitFor(() => {
        if (accounts.queried) {
            return true;
        }
        return false;
    });
    if (accounts.registered.length == 0) {
        ssoLog('no accounts registered');
        return;
    }
    accounts.active = accounts.registered[0];
    ssoLog('active account: ' + accounts.active.username);

    // load profile picture and set it as icon
    if (!graph_api_token || graph_api_token.expiresOn < (Date.now() + 60000)) {
        graph_api_token = null;
        port.postMessage({'command': 'acquireTokenSilently', 'account': accounts.active});
        await waitFor(() => {return graph_api_token !== null; });
        ssoLog('API token acquired');
    }
    const response = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
        headers: {
            'Content-Type': 'image/jpeg',
            'Authorization': 'Bearer ' + graph_api_token.accessToken
        }
    });
    if (response.ok) {
        let avatar = await createImageBitmap(await response.blob());
        let canvas = new OffscreenCanvas(48, 48);
        let ctx = canvas.getContext('2d');
        ctx.save();
        ctx.beginPath();
        ctx.arc(24, 24, 24, 0, Math.PI * 2, false);
        ctx.clip();
        ctx.drawImage(avatar, 0, 0);
        ctx.restore();
        chrome.action.setIcon({
            'imageData': ctx.getImageData(0, 0, 48, 48)
        });
    } else {
        ssoLog('Warning: Could not get profile picture.');
    }
    chrome.action.setTitle({
        title: 'EntraID SSO: ' + accounts.active.username}
    );
}

function logout() {
    accounts.active = null;
    accounts.queried = false;
    if (isFirefox()) {
        chrome.action.setIcon({
            'path': 'icons/linux-entra-sso.svg'
        });
    } else {
        chrome.action.setIcon({
            'path': {
                '48': 'icons/linux-entra-sso_48.png',
                '128': 'icons/linux-entra-sso_128.png'
            }
        });
    }
    let title = 'EntraID SSO disabled. Click to enable.'
    if (state_active)
        title = 'EntraID SSO disabled (waiting for broker).'
    chrome.action.setTitle({title: title});
}

async function get_or_request_prt(ssoUrl) {
    ssoLog('request new PrtSsoCookie from broker for ssoUrl: ' + ssoUrl);
    port.postMessage({
        'command': 'acquirePrtSsoCookie',
        'account': accounts.active,
        'ssoUrl': ssoUrl})
    await waitFor(() => {
        if (prt_sso_cookie.hasData) {
            return true;
        }
        return false;
    })
    prt_sso_cookie.hasData = false;
    const data = prt_sso_cookie.data
    if ('error' in data) {
        ssoLog('could not acquire PRT SSO cookie: ' + data.error);
    }
    return data;
}

async function on_before_send_headers(e) {
    // filter out requests that are not part of the OAuth2.0 flow
    accept = e.requestHeaders.find(header => header.name.toLowerCase() === "accept")
    if (accept === undefined || !accept.value.includes('text/html')) {
        return { requestHeaders: e.requestHeaders };
    }
    if (!broker_online || accounts.active === null) {
        return { requestHeaders: e.requestHeaders };
    }
    let prt = await get_or_request_prt(e.url);
    if ('error' in prt) {
        return { requestHeaders: e.requestHeaders };
    }
    // ms-oapxbc OAuth2 protocol extension
    ssoLog('inject PRT SSO into request headers');
    e.requestHeaders.push({"name": prt.cookieName, "value": prt.cookieContent})
    return { requestHeaders: e.requestHeaders };
}

async function update_net_rules(e) {
    ssoLog('update network rules');
    const SSO_URL = 'https://login.microsoftonline.com';
    let prt = await get_or_request_prt(SSO_URL);
    if ('error' in prt) {
        ssoLogError('could not acquire PRT SSO cookie: ' + prt.error);
        return;
    }
    const newRules = [
        {
            id: 1,
            priority: 1,
            condition: {
                urlFilter: SSO_URL + '/*',
                resourceTypes: ['main_frame']
            },
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{ header: prt.cookieName, operation: 'set', value: prt.cookieContent }]
            }
        }
    ];
    const oldRules = await chrome.declarativeNetRequest.getSessionRules();
    const oldRuleIds = oldRules.map(rule => rule.id);
    
    // Use the arrays to update the dynamic rules
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: oldRuleIds,
      addRules: newRules
    });
    ssoLog('network rules updated');
}

async function on_message(response) {
    if (response.command == "acquirePrtSsoCookie") {
        prt_sso_cookie.data = response.message;
        prt_sso_cookie.hasData = true;
    } else if (response.command == "getAccounts") {
        accounts.queried = true;
        if ('error' in response) {
            ssoLog('could not get accounts: ' + response.error);
            return;
        }
        accounts.registered = response.message.accounts;
    } else if (response.command == "acquireTokenSilently") {
        if ('error' in response) {
            ssoLog('could not acquire token silently: ' + response.error);
            return;
        }
        graph_api_token = response.message.brokerTokenResponse;
    } else if (response.command == "brokerStateChanged") {
        if (!state_active)
            return;
        if (response.message == 'online') {
            ssoLog('connection to broker restored');
            broker_online = true;
            chrome.action.enable();
            await load_accounts();
            if (!isFirefox()) {
                update_net_rules();
            }
        } else {
            ssoLog('lost connection to broker');
            broker_online = false;
            chrome.action.disable();
            logout();
        }
    }
    else {
        ssoLog('unknown command: ' + response.command);
    }
}

function on_startup() {
    if (initialized) {
        ssoLog('linux-entra-sso already initialized');
        return;
    }
    initialized = true;
    ssoLog('start linux-entra-sso');

    port =  chrome.runtime.connectNative("linux_entra_sso");
    chrome.action.disable();
    logout();

    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            ssoLogError('Error in native application connection:' +
                chrome.runtime.lastError);
        } else {
            ssoLogError('Native application connection closed.');
        }
    });

    port.onMessage.addListener(on_message);

    if (isFirefox()) {
        browser.webRequest.onBeforeSendHeaders.addListener(
            on_before_send_headers,
            { urls: ["https://login.microsoftonline.com/*"] },
            ["blocking", "requestHeaders"]
        );
    } else {
        chrome.alarms.create('prt-sso-refresh', {
            periodInMinutes: CHROME_PRT_SSO_REFRESH_INTERVAL_MIN
          });
        chrome.alarms.onAlarm.addListener((alarm) => {
            if (broker_online) {
                update_net_rules(alarm);
            }
        });
    }

    chrome.action.onClicked.addListener(() => {
        state_active = !state_active;
        if (state_active && broker_online) {
            load_accounts();
        } else {
            logout();
        }
    });
}

// use this API to prevent the extension from being disabled
chrome.runtime.onStartup.addListener(on_startup);

on_startup();
