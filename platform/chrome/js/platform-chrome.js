/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform.js";
import { ssoLog } from "./utils.js";

export class PlatformChrome extends Platform {
    browser = "Chrome";
    #update_net_rules_cb = null;

    static CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;

    constructor() {
        super();
        this.#update_net_rules_cb = this.#update_net_rules.bind(this);
    }

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        if (!enabled) {
            chrome.alarms.onAlarm.removeListener(this.#update_net_rules_cb);
            chrome.alarms.clear("prt-sso-refresh");
            this.#clear_net_rules();
            return;
        }
        this.#ensure_refresh_alarm("prt-sso-refresh");
        this.#update_net_rules();
    }

    /*
     * Ensure the alarm is armed exactly once.
     */
    async #ensure_refresh_alarm(alarm_id) {
        const alarm = await chrome.alarms.get(alarm_id);
        if (!alarm) {
            await chrome.alarms.create(alarm_id, {
                periodInMinutes:
                    PlatformChrome.CHROME_PRT_SSO_REFRESH_INTERVAL_MIN,
            });
        }
        if (!chrome.alarms.onAlarm.hasListener(this.#update_net_rules_cb)) {
            chrome.alarms.onAlarm.addListener(this.#update_net_rules_cb);
        }
    }

    async #clear_net_rules() {
        ssoLog("clear network rules");
        const oldRules = await chrome.declarativeNetRequest.getSessionRules();
        const oldRuleIds = oldRules.map((rule) => rule.id);
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: oldRuleIds,
        });
    }

    async #update_net_rules(e) {
        ssoLog("update network rules");
        var prt = undefined;
        try {
            prt = await this.broker.acquirePrtSsoCookie(
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
                    urlFilter: Platform.SSO_URL + "/*",
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
