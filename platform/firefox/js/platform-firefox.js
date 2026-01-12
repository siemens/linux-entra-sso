/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { ssoLog } from "./utils.js";

export class PlatformFirefox extends Platform {
    browser = "Firefox";
    /* PRT injection state */
    #on_before_send_headers = null;

    constructor() {
        super();
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: "/icons/linux-entra-sso.svg",
        });
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        /*
         * We need to bind, as the handler is called from a different context.
         * To be able to deregister the handler, we need to assign it to a
         * named symbol.
         */
        this.#on_before_send_headers = this.#onBeforeSendHeaders.bind(
            this,
            broker,
        );

        chrome.webRequest.onBeforeSendHeaders.removeListener(
            this.#on_before_send_headers,
        );

        if (!enabled || this.well_known_app_filters.length == 0) return;
        chrome.webRequest.onBeforeSendHeaders.addListener(
            this.#on_before_send_headers,
            {
                urls: this.well_known_app_filters,
                types: ["main_frame", "sub_frame"],
            },
            ["blocking", "requestHeaders"],
        );
    }

    async #onBeforeSendHeaders(broker, e) {
        // filter out requests that are not part of the OAuth2.0 flow
        if (!e.url.startsWith(Platform.SSO_URL)) {
            return { requestHeaders: e.requestHeaders };
        }
        try {
            let prt = await broker.acquirePrtSsoCookie(this.account, e.url);
            // ms-oapxbc OAuth2 protocol extension
            ssoLog("inject PRT SSO into request headers");
            e.requestHeaders.push({
                name: prt.cookieName,
                value: prt.cookieContent,
            });
        } catch (error) {
            ssoLog(error);
        }
        return { requestHeaders: e.requestHeaders };
    }
}
