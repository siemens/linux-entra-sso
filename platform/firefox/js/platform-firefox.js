/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { ssoLog } from "./utils.js";

export class PlatformFirefox extends Platform {
    browser = "Firefox";
    /*
     * We use a blocking webRequest handler for PRT injection, which requires a
     * running service worker. Keep the NM connection alive to prevent the MV3
     * worker from being shut down.
     */
    static KEEP_BROKER_CONNECTED = true;
    /* PRT injection state */
    #on_before_send_headers = null;
    #broker = null;

    constructor() {
        super();
        /*
         * Bind once to a stable reference so removeListener can actually
         * deregister the handler.
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
        this.#broker = broker;

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

    async #onBeforeSendHeaders(e) {
        // filter out requests that are not part of the OAuth2.0 flow
        if (!e.url.startsWith(Platform.SSO_URL)) {
            return { requestHeaders: e.requestHeaders };
        }
        try {
            let prt = await this.#broker.acquirePrtSsoCookie(
                this.account,
                e.url,
            );
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
