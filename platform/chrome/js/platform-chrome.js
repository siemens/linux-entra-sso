/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { getLogger } from "./utils.js";

const log = getLogger("platform");

export class PlatformChrome extends Platform {
    browser = "Chrome";
    #broker = null;
    #enabled = false;
    #on_alarm_cb = null;
    #seen_nonces = new Set();
    #pending_requests = new Map();
    #nonce_rules_queue = Promise.resolve();

    static CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;
    static PRT_SSO_REFRESH_ALARM = "prt-sso-refresh";
    static PRT_SSO_RETRY_ALARM = "prt-sso-retry";
    static PRT_SSO_RETRY_DELAY_MIN = 1;
    static SSO_RECOVERY_DONE = "sso_recovery_done";
    static NONCE_RULE_ID_BASE = 2;

    constructor() {
        super();
        /*
         * Register the alarm listener synchronously during worker startup.
         * Only top-level listeners can wake a suspended MV3 service worker,
         * so this is required for the periodic PRT refresh to fire reliably.
         */
        this.#on_alarm_cb = this.#on_alarm.bind(this);
        chrome.alarms.onAlarm.addListener(this.#on_alarm_cb);
        chrome.webRequest.onBeforeRequest.addListener(
            this.#on_sso_request.bind(this),
            {
                urls: [Platform.SSO_URL + "/*"],
                types: ["main_frame", "sub_frame"],
            },
        );
        const filter = {
            urls: [Platform.SSO_URL + "/*"],
            types: ["main_frame"],
        };
        const settle = (outcome) => (details) =>
            this.#pending_requests.get(details.requestId)?.(outcome);
        chrome.webRequest.onBeforeRedirect.addListener(
            settle("redirect"),
            filter,
        );
        chrome.webRequest.onCompleted.addListener(settle("completed"), filter);
        chrome.webRequest.onErrorOccurred.addListener(settle("error"), filter);
    }

    /*
     * Entra requests a cookie bound to an sso_nonce, e.g. to satisfy a
     * sign-in frequency policy. Acquire one for that exact URL and inject it
     * into requests of the issuing tab that carry an sso_nonce, then
     * re-request the sign-in once. Other sign-ins keep the generic cookie,
     * so Entra asks for a new nonce as needed.
     */
    async #on_sso_request(details) {
        if (!this.#enabled || details.tabId < 0) return;
        // not awaited, so it doesn't delay updating this tab's rule
        this.#remove_orphaned_nonce_rules();
        const main_frame = details.type === "main_frame";
        // watch from the start, the request may finish while we acquire
        const finished = main_frame && this.#watch_request(details.requestId);
        try {
            if (!(await this.#update_nonce_rule(details))) return;
            if (!main_frame) return;
            log.info("re-requesting sign-in with nonce-bound SSO token");
            if (await this.#update_tab(details.tabId, details.url)) return;
            /*
             * Chrome rejects the navigation while the original request is
             * pending. Retry once it got a response, unless it redirected
             * away, i.e. the sign-in went ahead.
             */
            if ((await finished) === "redirect") return;
            log.info("retrying re-request of sign-in");
            await this.#update_tab(details.tabId, details.url);
        } finally {
            if (main_frame) this.#pending_requests.delete(details.requestId);
        }
    }

    #watch_request(requestId) {
        return new Promise((resolve) =>
            this.#pending_requests.set(requestId, resolve),
        );
    }

    async #update_nonce_rule(details) {
        const nonce = URL.parse(details.url)?.searchParams.get("sso_nonce");
        if (!nonce || this.#seen_nonces.has(nonce)) return false;
        this.#seen_nonces.add(nonce);
        let prt = undefined;
        try {
            prt = await this.#broker.acquirePrtSsoCookie(
                this.account,
                details.url,
            );
        } catch (error) {
            log.warn("Failed to acquire nonce-bound SSO token: " + error);
            return false;
        }
        await this.#add_nonce_rule(details.tabId, prt);
        return true;
    }

    /*
     * Nonce rule ids are picked based on the current rules, so updates
     * must not interleave. Otherwise two tabs could pick the same id.
     */
    #with_nonce_rules(fn) {
        const run = this.#nonce_rules_queue.then(fn);
        this.#nonce_rules_queue = run.catch(() => {});
        return run;
    }

    /*
     * Add a nonce rule for the given tab, which only matches requests
     * carrying an sso_nonce (^ matches a separator like ? or &). It replaces
     * the tab's previous nonce rule, else takes the lowest free id. Rules of
     * different tabs never match the same request, hence they can share a
     * priority.
     */
    #add_nonce_rule(tabId, prt) {
        return this.#with_nonce_rules(async () => {
            const rules = await chrome.declarativeNetRequest.getSessionRules();
            const previous = rules.find(
                (rule) =>
                    rule.id >= PlatformChrome.NONCE_RULE_ID_BASE &&
                    rule.condition.tabIds?.includes(tabId),
            );
            let id = previous?.id;
            if (id === undefined) {
                const ids = new Set(rules.map((rule) => rule.id));
                id = PlatformChrome.NONCE_RULE_ID_BASE;
                while (ids.has(id)) id++;
            }
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [id],
                addRules: [
                    this.#sso_rule(id, prt, {
                        priority: 2,
                        tabIds: [tabId],
                        urlFilter: "|" + Platform.SSO_URL + "/*^sso_nonce=",
                    }),
                ],
            });
        });
    }

    #remove_orphaned_nonce_rules() {
        return this.#with_nonce_rules(async () => {
            const rules = await chrome.declarativeNetRequest.getSessionRules();
            const tabs = await chrome.tabs.query({});
            const tabIds = new Set(tabs.map((tab) => tab.id));
            const orphaned = rules
                .filter(
                    (rule) =>
                        rule.id >= PlatformChrome.NONCE_RULE_ID_BASE &&
                        !rule.condition.tabIds?.some((id) => tabIds.has(id)),
                )
                .map((rule) => rule.id);
            if (orphaned.length === 0) return;
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: orphaned,
            });
        });
    }

    async #update_tab(tabId, url) {
        try {
            await chrome.tabs.update(tabId, { url });
            return true;
        } catch (error) {
            log.warn("Failed to re-request sign-in: " + error);
            return false;
        }
    }

    #sso_rule(
        id,
        prt,
        { priority = 1, tabIds, urlFilter = "|" + Platform.SSO_URL + "/" } = {},
    ) {
        return {
            id: id,
            priority: priority,
            condition: {
                urlFilter: urlFilter,
                requestDomains: [URL.parse(Platform.SSO_URL).hostname],
                resourceTypes: ["main_frame", "sub_frame"],
                ...(tabIds && { tabIds }),
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
        };
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        this.#broker = broker;
        this.#enabled = enabled;
        if (!enabled) {
            chrome.alarms.clear(PlatformChrome.PRT_SSO_REFRESH_ALARM);
            chrome.alarms.clear(PlatformChrome.PRT_SSO_RETRY_ALARM);
            this.#clear_net_rules();
            return;
        }
        this.#ensure_refresh_alarm(PlatformChrome.PRT_SSO_REFRESH_ALARM);
        this.#update_net_rules(broker);
    }

    /*
     * Called when the refresh alarm fires (possibly waking the worker).
     * If the broker/account are not ready yet, the regular startup flow will
     * refresh the rules, so we can safely skip here.
     */
    #on_alarm(alarm) {
        if (
            alarm.name !== PlatformChrome.PRT_SSO_REFRESH_ALARM &&
            alarm.name !== PlatformChrome.PRT_SSO_RETRY_ALARM
        )
            return;
        if (!this.#broker || !this.account) return;
        this.#update_net_rules(this.#broker);
    }

    /*
     * Ensure the alarm is armed with the configured period. If an alarm with
     * a different period already exists, it is re-created.
     */
    async #ensure_refresh_alarm(alarm_id) {
        const period = PlatformChrome.CHROME_PRT_SSO_REFRESH_INTERVAL_MIN;
        const alarm = await chrome.alarms.get(alarm_id);
        if (alarm && alarm.periodInMinutes === period) {
            return;
        }
        await chrome.alarms.create(alarm_id, {
            periodInMinutes: period,
        });
    }

    async #clear_net_rules() {
        log.debug("clear network rules");
        const oldRules = await chrome.declarativeNetRequest.getSessionRules();
        const oldRuleIds = oldRules.map((rule) => rule.id);
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: oldRuleIds,
        });
        this.#seen_nonces.clear();
        this.clear_error();
    }

    async #update_net_rules(broker) {
        log.debug("update network rules");
        let prt = undefined;
        try {
            prt = await broker.acquirePrtSsoCookie(
                this.account,
                Platform.SSO_URL,
            );
        } catch (error) {
            this.report_error("Failed to acquire the SSO token: " + error);
            // e.g. the broker refuses while the screen is locked after a wakeup
            chrome.alarms.create(PlatformChrome.PRT_SSO_RETRY_ALARM, {
                delayInMinutes: PlatformChrome.PRT_SSO_RETRY_DELAY_MIN,
            });
            return;
        }
        const newRules = [this.#sso_rule(1, prt)];
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [1],
            addRules: newRules,
        });
        this.clear_error();
        log.debug("network rules updated");
        await this.#recover_missed_navigations();
    }

    /*
     * Session rules do not survive a browser restart. Top-level sign-in
     * requests sent before the first rule of this browser session existed
     * went out without the SSO header and Entra fell back to interactive
     * sign-in. Re-request them once.
     */
    async #recover_missed_navigations() {
        const flag = PlatformChrome.SSO_RECOVERY_DONE;
        const data = await chrome.storage.session.get(flag);
        if (data[flag]) return;
        await chrome.storage.session.set({ [flag]: true });
        const queryOptions = {
            url: Platform.SSO_URL + "/*",
        };
        for (const tab of await chrome.tabs.query(queryOptions)) {
            const url = URL.parse(tab.url || "");
            if (!url) continue;
            if (!/\/oauth2\/(v2\.0\/)?authorize$|\/saml2$/.test(url.pathname))
                continue;
            log.info("re-requesting sign-in tab that missed SSO");
            await this.#update_tab(tab.id, url.href);
        }
    }
}
