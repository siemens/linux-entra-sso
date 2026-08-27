/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { getLogger } from "./utils.js";
import { StateMachine } from "./state-machine.js";

const log = getLogger("platform");

/*
 * Whether PRT injection can be performed. UNKNOWN means that the startup did
 * not report a state yet.
 */
const InjectionState = Object.freeze({
    UNKNOWN: "unknown",
    ACTIVE: "active",
    INACTIVE: "inactive",
});

const INJECTION_TRANSITIONS = Object.freeze({
    [InjectionState.UNKNOWN]: [InjectionState.ACTIVE, InjectionState.INACTIVE],
    [InjectionState.ACTIVE]: [InjectionState.INACTIVE],
    [InjectionState.INACTIVE]: [InjectionState.ACTIVE],
});

class InjectionStateMachine extends StateMachine {
    constructor() {
        super("injection-state", INJECTION_TRANSITIONS, InjectionState.UNKNOWN);
    }

    is_active() {
        return this.is_in(InjectionState.ACTIVE);
    }

    set_active(active) {
        return this.transition(
            active ? InjectionState.ACTIVE : InjectionState.INACTIVE,
        );
    }
}

export class PlatformFirefox extends Platform {
    browser = "Firefox";
    /*
     * We use a blocking webRequest handler for PRT injection, which requires a
     * running service worker. Keep the NM connection alive to prevent the MV3
     * worker from being shut down.
     */
    static KEEP_BROKER_CONNECTED = true;

    #broker = null;
    #injection = new InjectionStateMachine();

    constructor() {
        super();
        /*
         * The handler stays registered for the whole lifetime, whether SSO
         * is performed is decided by the injection state.
         */
        chrome.webRequest.onBeforeSendHeaders.addListener(
            this.#onBeforeSendHeaders.bind(this),
            {
                urls: [Platform.SSO_URL + "/*"],
                types: ["main_frame", "sub_frame"],
            },
            ["blocking", "requestHeaders"],
        );
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: "/icons/linux-entra-sso.svg",
        });
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        this.#broker = broker;
        this.#injection.set_active(Boolean(enabled && account && broker));
    }

    async #onBeforeSendHeaders(e) {
        const headers = { requestHeaders: e.requestHeaders };
        // filter out requests that are not part of the OAuth2.0 flow
        const url = URL.parse(e.url);
        if (
            url?.protocol !== "https:" ||
            url.origin !== URL.parse(Platform.SSO_URL).origin
        ) {
            return headers;
        }
        if (!this.#injection.is_active()) {
            log.warn("SSO not available, pass request unmodified");
            return headers;
        }
        try {
            let prt = await this.#broker.acquirePrtSsoCookie(
                this.account,
                e.url,
            );
            // ms-oapxbc OAuth2 protocol extension
            log.debug("inject PRT SSO into request headers");
            e.requestHeaders.push({
                name: prt.cookieName,
                value: prt.cookieContent,
            });
        } catch (error) {
            log.error("failed to inject PRT SSO cookie", error);
        }
        return headers;
    }
}
