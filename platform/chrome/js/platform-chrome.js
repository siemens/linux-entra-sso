/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { ssoLog } from "./utils.js";

export class PlatformChrome extends Platform {
    browser = "Chrome";
    #broker = null;
    #on_alarm_cb = null;

    static CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;
    static PRT_SSO_REFRESH_ALARM = "prt-sso-refresh";
    /*
     * PRT injection uses declarativeNetRequest, which does not require a
     * running service worker, so the NM connection can idle out.
     */
    static KEEP_BROKER_CONNECTED = false;

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
        if (alarm.name !== PlatformChrome.PRT_SSO_REFRESH_ALARM) return;
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
        ssoLog("clear network rules");
        const oldRules = await chrome.declarativeNetRequest.getSessionRules();
        const oldRuleIds = oldRules.map((rule) => rule.id);
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: oldRuleIds,
        });
    }

    async #update_net_rules(broker) {
        ssoLog("update network rules");
        let prt = undefined;
        try {
            prt = await broker.acquirePrtSsoCookie(
                this.account,
                Platform.SSO_URL,
            );
        } catch (error) {
            ssoLog(error);
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
        ssoLog("network rules updated");
    }
}
