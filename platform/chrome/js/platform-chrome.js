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
    #on_alarm_cb = null;

    static CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;
    static PRT_SSO_REFRESH_ALARM = "prt-sso-refresh";
    static PRT_SSO_RETRY_ALARM = "prt-sso-retry";
    static PRT_SSO_RETRY_DELAY_MIN = 1;
    static SSO_RECOVERY_DONE = "sso_recovery_done";

    constructor() {
        super();
        /*
         * Register the alarm listener synchronously during worker startup.
         * Only top-level listeners can wake a suspended MV3 service worker,
         * so this is required for the periodic PRT refresh to fire reliably.
         */
        this.#on_alarm_cb = this.#on_alarm.bind(this);
        chrome.alarms.onAlarm.addListener(this.#on_alarm_cb);
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        this.#broker = broker;
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
        const newRules = [
            {
                id: 1,
                priority: 1,
                condition: {
                    urlFilter: "|" + Platform.SSO_URL + "/",
                    requestDomains: [URL.parse(Platform.SSO_URL).hostname],
                    resourceTypes: ["main_frame", "sub_frame"],
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
            chrome.tabs.update(tab.id, { url: url.href });
        }
    }
}
