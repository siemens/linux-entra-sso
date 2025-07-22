/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, Deferred } from "./utils.js";

export class PolicyManager {
    static MANAGED_POLICIES_KEY = "wellKnownApps";
    #apps = null;

    async load_policies() {
        let dfd = new Deferred();
        chrome.storage.managed.get(
            PolicyManager.MANAGED_POLICIES_KEY,
            (data) => {
                if (
                    typeof data === "object" &&
                    data.hasOwnProperty("wellKnownApps")
                ) {
                    this.#apps = { ...data.wellKnownApps };
                    ssoLog("managed policies loaded");
                }
                dfd.resolve();
            },
        );
        return dfd.promise;
    }

    getPolicyUpdate(active_app_filters) {
        function matches_filter(app, policy) {
            return (
                app.replace("*://", "https://") == "https://" + policy + "/*"
            );
        }

        let gpo_update = {
            pending: false,
            apps_to_add: [],
            apps_to_remove: [],
            apps_managed: this.#apps,
        };
        if (this.#apps === null) return gpo_update;

        for (const [app, enabled] of Object.entries(this.#apps)) {
            if (
                !enabled &&
                active_app_filters.some((value) => matches_filter(value, app))
            ) {
                gpo_update.apps_to_remove.push(app);
                gpo_update.pending = true;
            } else if (
                enabled &&
                !active_app_filters.some((value) => matches_filter(value, app))
            ) {
                gpo_update.apps_to_add.push(app);
                gpo_update.pending = true;
            }
        }

        return gpo_update;
    }
}
