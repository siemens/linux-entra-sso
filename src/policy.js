/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { getLogger, Deferred } from "./utils.js";

const log = getLogger("policy");

export class PolicyManager {
    static MANAGED_POLICIES_KEYS = [
        "wellKnownApps",
        "loadProfilePicture",
        "checkDeviceCompliance",
    ];
    #apps = null;
    /* managed feature toggles, undefined means "not configured" */
    #features = {};

    async load_policies() {
        const dfd = new Deferred();
        chrome.storage.managed.get(
            PolicyManager.MANAGED_POLICIES_KEYS,
            (data) => {
                this.#apps = null;
                if (data !== null && typeof data === "object") {
                    if (data.hasOwnProperty("wellKnownApps")) {
                        this.#apps = { ...data.wellKnownApps };
                        if (
                            this.#apps["*"] === true &&
                            Object.keys(this.#apps).length > 1
                        ) {
                            log.warn(
                                "wellKnownApps: '*' ignored, policy is mixed",
                            );
                        }
                    }
                    this.#features = {
                        loadProfilePicture: data.loadProfilePicture,
                        checkDeviceCompliance: data.checkDeviceCompliance,
                    };
                    log.debug("managed policies loaded");
                }
                dfd.resolve();
            },
        );
        return dfd.promise;
    }

    /**
     * @returns the value a managed policy pins the feature to, or undefined
     * if the feature is not managed
     */
    getFeature(feature) {
        return this.#features[feature];
    }

    getPolicyUpdate(active_app_filters) {
        function matches_filter(app, policy) {
            return (
                app.replace("*://", "https://") == "https://" + policy + "/*"
            );
        }

        const catch_all = active_app_filters.filter((value) =>
            matches_filter(value, "*"),
        );
        const gpo_update = {
            pending: false,
            filters_to_add: [],
            filters_to_remove: [],
            has_catch_all: catch_all.length > 0,
            apps_managed: this.#apps,
        };
        if (this.#apps === null) return gpo_update;

        // A sole explicit wildcard is an opt-in to all HTTPS applications.
        // Mixed with per-site entries it cannot express exclusions, so the
        // policy is then treated as an exact-site policy (see load_policies).
        const allow_all =
            this.#apps["*"] === true && Object.keys(this.#apps).length === 1;
        if (allow_all) {
            if (!gpo_update.has_catch_all) {
                gpo_update.filters_to_add.push("https://*/*");
                gpo_update.pending = true;
            }
            return gpo_update;
        }
        if (gpo_update.has_catch_all) {
            gpo_update.filters_to_remove.push(...catch_all);
            gpo_update.pending = true;
        }
        for (const [app, enabled] of Object.entries(this.#apps)) {
            if (app === "*") continue;
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
