/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

function ssoLog(message) {
    console.log('[EntraID SSO] ' + message)
}

ssoLog('started sso-mib')

let port = browser.runtime.connectNative("sso_mib");
let prt_sso_cookie = {
    data: {},
    hasData: false
};
let accounts = {
    registered: [],
    active: null,
    queried: false
};
let graph_api_token = null;
load_accounts();

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
    ssoLog('active account: ', accounts.active);

    // load profile picture and set it as icon
    port.postMessage({'command': 'acquireTokenSilently', 'account': accounts.active});
    await waitFor(() => {return graph_api_token !== null; });
    ssoLog('API token acquired');
    const response = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
        headers: {
            'Content-Type': 'image/jpeg',
            'Authorization': 'Bearer ' + graph_api_token.accessToken
        }
      });
    browser.action.setIcon({
        'path': URL.createObjectURL(await response.blob())
    });
    browser.action.setTitle({
        title: 'EntraID SSO: ' + accounts.active.username}
    );
}

function logout() {
    accounts.active = null;
    accounts.queried = false;
    browser.action.setIcon({
        'path': 'icons/sso-mib.svg'
    });
    browser.action.setTitle({
        title: 'EntraID SSO disabled. Click to enable.'
    });
}

async function get_or_request_prt(ssoUrl) {
    ssoLog('request new PrtSsoCookie from broker for ssoUrl: ', ssoUrl);
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
    data = prt_sso_cookie.data
    if ('error' in data) {
        ssoLog('could not acquire PRT SSO cookie: ', data.error);
    }
    return data;
}

/*
 * This function set a key-value pair in HTTP header "Cookie",
 *   and returns the value of HTTP header after modification.
 * If key already exists, it modify the value.
 * If key doesn't exist, it add the key-value pair.
 * If value is undefined, it delete the key-value pair from cookies.
 *
 * Assuming that, the same key SHOULD NOT appear twice in cookies.
 * Also assuming that, all cookies doesn't contains semicolon.
 *   (99.9% websites are following these rules)
 *
 * Example:
 *   cookie_keyvalues_set("msg=good; user=recolic; password=test", "user", "p")
 *     => "msg=good; user=p; password=test"
 *   cookie_keyvalues_set("msg=good; user=recolic; password=test", "time", "night")
 *     => "msg=good; user=recolic; password=test;time=night"
 *
 * Recolic K <root@recolic.net>
 * License: MPL2.0
 */
function cookie_keyvalues_set(original_cookies, key, value) {
    let new_element = " " + key + "=" + value; // not used if value is undefined.
    let cookies_ar = original_cookies.split(";").filter(e => e.trim().length > 0);
    let selected_cookie_index = cookies_ar.findIndex(kv => kv.trim().startsWith(key+"="));
    if ((selected_cookie_index == -1) && (value != undefined)) {
        cookies_ar.push(new_element);
    } else {
        if (value === undefined)
            cookies_ar.splice(selected_cookie_index, 1);
        else
            cookies_ar.splice(selected_cookie_index, 1, new_element);
    }
    return cookies_ar.join(";");
}

async function on_before_send_headers(e) {
    let header_cookie = e.requestHeaders.find(header => header.name.toLowerCase() === "cookie");
    // filter out requests that are not part of the OAuth2.0 flow
    accept = e.requestHeaders.find(header => header.name.toLowerCase() === "accept")
    if (accept === undefined || !accept.value.includes('text/html')) {
        return { requestHeaders: e.requestHeaders };
    }
    if (accounts.active === null) {
        return { requestHeaders: e.requestHeaders };
    }
    let prt = await get_or_request_prt(e.url);
    if ('error' in prt) {
        return { requestHeaders: e.requestHeaders };
    }
    ssoLog('inject PRT SSO cookie into request headers');
    let new_cookie = cookie_keyvalues_set(header_cookie === undefined ? "" : header_cookie.value, prt.cookieName, prt.cookieContent);
    // no cookies at all
    if (header_cookie === undefined) {
        e.requestHeaders.push({"name": "Cookie", "value": new_cookie});
    } else {
        header_cookie.value = new_cookie;
    }
    return { requestHeaders: e.requestHeaders };
}

browser.webRequest.onBeforeSendHeaders.addListener(
    on_before_send_headers,
    { urls: ["https://login.microsoftonline.com/*"] },
    ["blocking", "requestHeaders"]
);

port.onMessage.addListener((response) => {
    if (response.command == "acquirePrtSsoCookie") {
        prt_sso_cookie.data = response.message;
        prt_sso_cookie.hasData = true;
    } else if (response.command == "getAccounts") {
        accounts.queried = true;
        if ('error' in response) {
            ssoLog('could not get accounts: ', response.error);
            return;
        }
        accounts.registered = response.message.accounts;
    } else if (response.command == "acquireTokenSilently") {
        if ('error' in response) {
            ssoLog('could not acquire token silently: ', response.error);
            return;
        }
        graph_api_token = response.message.brokerTokenResponse;
    }
    else {
        ssoLog('unknown command: ', response.command);
    }
});

browser.action.onClicked.addListener(() => {
    if (accounts.active === null)
        load_accounts();
    else
        logout();
});
