/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform-abstraction.js";
import { ssoLog } from "./utils.js";

export class PlatformChrome extends Platform {
    browser = "Chrome";

    static SSO_URL = "https://login.microsoftonline.com";
    static CHROME_PRT_SSO_REFRESH_INTERVAL_MIN = 30;

    update_request_handlers(enabled, account, broker) {
        super.update_request_handlers(enabled, account, broker);
        if (!enabled) {
            chrome.alarms.clear("prt-sso-refresh");
            this.#clear_net_rules();
            return;
        }
        chrome.alarms.create("prt-sso-refresh", {
            periodInMinutes: PlatformChrome.CHROME_PRT_SSO_REFRESH_INTERVAL_MIN,
        });
        chrome.alarms.onAlarm.addListener((alarm) => {
            this.#update_net_rules(alarm);
        });
        this.#update_net_rules();
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
        let prt = await this.broker.acquirePrtSsoCookie(
            this.account,
            PlatformChrome.SSO_URL,
        );
        if ("error" in prt) {
            ssoLogError("could not acquire PRT SSO cookie: " + prt.error);
            return;
        }
        const newRules = [
            {
                id: 1,
                priority: 1,
                condition: {
                    urlFilter: PlatformChrome.SSO_URL + "/*",
                    resourceTypes: ["main_frame"],
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

export function create_platform() {
    return new PlatformChrome();
}
