/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 */

import { getLogger } from "./utils.js";

const log = getLogger("settings");

/* user-configurable features, named after their managed policy counterpart */
export const Feature = Object.freeze({
    PROFILE_PICTURE: "loadProfilePicture",
    DEVICE_COMPLIANCE: "checkDeviceCompliance",
});

/**
 * User settings, overruled by the managed policies. All features are
 * opt-out, so an unconfigured feature is enabled.
 */
export class SettingsManager {
    static STORAGE_KEY = "settings";

    #policy = null;
    /* user choices, undefined means "not configured" */
    #user = {};

    constructor(policy = null) {
        this.#policy = policy;
    }

    isEnabled(feature) {
        const managed = this.#policy?.getFeature(feature);
        if (managed !== undefined) return managed;
        return this.#user[feature] !== false;
    }

    /**
     * @returns if the feature is pinned by a managed policy and hence must
     * not be changed by the user
     */
    isManaged(feature) {
        return this.#policy?.getFeature(feature) !== undefined;
    }

    /**
     * @returns if the setting was changed
     */
    async set(feature, enabled) {
        if (this.isManaged(feature)) {
            log.warn(`${feature} is managed by policy, ignoring change`);
            return false;
        }
        if (this.#user[feature] === enabled) return false;
        this.#user[feature] = enabled;
        log.info(`${feature} ${enabled ? "enabled" : "disabled"} by user`);
        await this.persist();
        return true;
    }

    async persist() {
        return chrome.storage.local.set({
            [SettingsManager.STORAGE_KEY]: this.#user,
        });
    }

    async restore() {
        const data = await chrome.storage.local.get(
            SettingsManager.STORAGE_KEY,
        );
        this.#user = data[SettingsManager.STORAGE_KEY] ?? {};
    }
}
