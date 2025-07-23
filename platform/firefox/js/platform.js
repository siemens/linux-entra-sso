/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform-abstraction.js";
import { ssoLog } from "./utils.js";

export class PlatformFirefox extends Platform {
    browser = "Firefox";
    /* PRT injection state */
    #on_before_send_headers = null;

    constructor() {
        super();
        /*
         * We need to bind, as the handler is called from a different context.
         * To be able to deregister the handler, we need to assign it to a
         * named symbol.
         */
        this.#on_before_send_headers = this.#onBeforeSendHeaders.bind(this);
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: "/icons/linux-entra-sso.svg",
        });
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        chrome.webRequest.onBeforeSendHeaders.removeListener(
            this.#on_before_send_headers,
        );

        if (!enabled) return;
        chrome.webRequest.onBeforeSendHeaders.addListener(
            this.#on_before_send_headers,
            { urls: ["https://login.microsoftonline.com/*"] },
            ["blocking", "requestHeaders"],
        );
    }

    async #onBeforeSendHeaders(e) {
        // filter out requests that are not part of the OAuth2.0 flow
        const accept = e.requestHeaders.find(
            (header) => header.name.toLowerCase() === "accept",
        );
        if (accept === undefined || !accept.value.includes("text/html")) {
            return { requestHeaders: e.requestHeaders };
        }
        let prt = await this.broker.acquirePrtSsoCookie(this.account, e.url);
        if ("error" in prt) {
            return { requestHeaders: e.requestHeaders };
        }
        // ms-oapxbc OAuth2 protocol extension
        ssoLog("inject PRT SSO into request headers");
        e.requestHeaders.push({
            name: prt.cookieName,
            value: prt.cookieContent,
        });
        return { requestHeaders: e.requestHeaders };
    }
}

export function create_platform() {
    return new PlatformFirefox();
}
