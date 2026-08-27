/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { getLogger, Deferred } from "./utils.js";
import { StateMachine } from "./state-machine.js";

const log = getLogger("platform");

/*
 * Whether PRT injection can be performed. UNKNOWN means that the event page
 * was just woken and did not restore its state yet.
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
    /* pending until the startup left the UNKNOWN state */
    #known = new Deferred();

    constructor() {
        super("injection-state", INJECTION_TRANSITIONS, InjectionState.UNKNOWN);
    }

    is_active() {
        return this.is_in(InjectionState.ACTIVE);
    }

    set_active(active) {
        this.transition(
            active ? InjectionState.ACTIVE : InjectionState.INACTIVE,
        );
        this.#known?.resolve();
        this.#known = null;
    }

    /*
     * Block the caller until the startup reported a state, but no longer
     * than the given time.
     */
    async await_known(timeout_ms) {
        if (!this.#known) return;
        const timeout = new Promise((resolve) =>
            setTimeout(resolve, timeout_ms),
        );
        await Promise.race([this.#known.promise, timeout]);
    }
}

export class PlatformFirefox extends Platform {
    browser = "Firefox";
    /* how long a blocked request waits for the startup to report a state */
    static STATE_TIMEOUT_MS = 5 * 1000;

    #broker = null;
    #injection = new InjectionStateMachine();

    constructor() {
        super();
        /*
         * Register the handler synchronously during page evaluation, as only
         * such listeners can wake a suspended event page.
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
        /* a woken event page has not restored its state yet */
        await this.#injection.await_known(PlatformFirefox.STATE_TIMEOUT_MS);
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
