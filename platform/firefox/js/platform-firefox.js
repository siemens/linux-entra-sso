/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { getLogger, Deferred, load_icon, decorate_icon } from "./utils.js";
import { StateMachine } from "./state-machine.js";
import { DEFAULT_STORE } from "./account.js";

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

    is_known() {
        return !this.is_in(InjectionState.UNKNOWN);
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
    /* cookie store Firefox reports for tabs without a contextual identity */
    static FIREFOX_DEFAULT_STORE = "firefox-default";

    #broker = null;
    #injection = new InjectionStateMachine();
    /* raw cookieStoreId of the currently active tab */
    #current_store = PlatformFirefox.FIREFOX_DEFAULT_STORE;

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

        /* track the active tab's container (Firefox only, not Thunderbird) */
        if (chrome.contextualIdentities) {
            const refresh = () => this.#refresh_current_store();
            chrome.tabs.onActivated.addListener(refresh);
            chrome.windows.onFocusChanged.addListener(refresh);
        }
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: "/icons/linux-entra-sso.svg",
        });
    }

    async getDisabledIconData(width, color) {
        const imgdata = await load_icon("/icons/linux-entra-sso_48.png", width);
        return decorate_icon(imgdata, width, color);
    }

    update_request_handlers(enabled, account, broker, resolve) {
        super.update_request_handlers(enabled, account, broker, resolve);
        this.#broker = broker;
        this.#injection.set_active(Boolean(enabled && broker));
        this.clear_error();
    }

    /* Map Firefox's default cookie store to the browser-neutral key. */
    store_key(cookieStoreId) {
        return !cookieStoreId ||
            cookieStoreId === PlatformFirefox.FIREFOX_DEFAULT_STORE
            ? DEFAULT_STORE
            : cookieStoreId;
    }

    /* Follow the active tab and notify when its container changes. */
    async #refresh_current_store() {
        let store = PlatformFirefox.FIREFOX_DEFAULT_STORE;
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                lastFocusedWindow: true,
            });
            if (tab?.cookieStoreId) store = tab.cookieStoreId;
        } catch (error) {
            log.warn("could not determine active tab container: " + error);
        }
        if (store === this.#current_store) return;
        this.#current_store = store;
        this.on_container_change?.();
    }

    get_current_store() {
        return this.store_key(this.#current_store);
    }

    async get_current_container_color() {
        if (this.get_current_store() === DEFAULT_STORE) return null;
        try {
            const ident = await chrome.contextualIdentities.get(
                this.#current_store,
            );
            return ident?.colorCode ?? null;
        } catch (error) {
            log.warn("could not get container color: " + error);
            return null;
        }
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
        if (!this.#injection.is_known()) {
            this.report_error(
                "Timed out while restoring the SSO state. " +
                    "Requests are sent without SSO, please reload the page.",
            );
            return headers;
        }
        /* resolve SSO for the container the request originates from */
        const store = this.store_key(e.cookieStoreId);
        const { active, account } = this.resolve_injection?.(store) ?? {};
        if (!active || !account) {
            return headers;
        }
        try {
            let prt = await this.#broker.acquirePrtSsoCookie(account, e.url);
            // ms-oapxbc OAuth2 protocol extension
            log.debug("inject PRT SSO into request headers");
            e.requestHeaders.push({
                name: prt.cookieName,
                value: prt.cookieContent,
            });
            this.clear_error();
        } catch (error) {
            this.report_error("Failed to acquire the SSO token: " + error);
        }
        return headers;
    }
}
