/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, Deferred } from "./utils.js";

export class PolicyManager {
    static MANAGED_POLICIES_KEY = "wellKnownApps";
    #apps = null;

    async load_policies() {
        const dfd = new Deferred();
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

        const catch_all = active_app_filters.find((value) =>
            matches_filter(value, "*"),
        );
        const gpo_update = {
            pending: false,
            filters_to_add: [],
            filters_to_remove: [],
            has_catch_all: catch_all !== undefined,
            apps_managed: this.#apps,
        };
        if (this.#apps === null) return gpo_update;

        if (gpo_update.has_catch_all) {
            gpo_update.filters_to_remove.push(catch_all);
            gpo_update.pending = true;
        }
        for (const [app, enabled] of Object.entries(this.#apps)) {
            let filter = active_app_filters.find((value) =>
                matches_filter(value, app),
            );
            if (!enabled && filter !== undefined) {
                gpo_update.filters_to_remove.push(filter);
                gpo_update.pending = true;
            } else if (enabled && filter === undefined) {
                gpo_update.filters_to_add.push("https://" + app + "/*");
                gpo_update.pending = true;
            }
        }

        return gpo_update;
    }
}
