/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, ssoLogError, jwt_get_payload } from "./utils.js";

export class Device {
    name = null;
    compliant = null;

    constructor(name, compliant) {
        this.name = name;
        this.compliant = compliant;
    }
}

export class DeviceManager {
    static DEVICE_REFRESH_INTERVAL_MIN = 30;

    #am = null;
    #last_refresh = 0;
    device = null;

    constructor(account_manager) {
        this.#am = account_manager;
        this.device = null;
    }

    /**
     * Update the device information if not recent enough. Subsequent calls
     * are cheap as the device information is fetched from the cache. Callers
     * must not immediately call this again in case the function returns false,
     * as error states are not cached (to allow recovering after sporadic errors).
     * @returns true if successfully updated
     */
    async updateDeviceInfo() {
        if (
            Date.now() <
            this.#last_refresh +
                DeviceManager.DEVICE_REFRESH_INTERVAL_MIN * 60 * 1000
        ) {
            return false;
        }
        return await this.loadDeviceInfo();
    }

    /**
     * Load information about the accessing device (e.g. compliance state)
     * @returns true on success
     */
    async loadDeviceInfo() {
        if (!this.#am.hasAccounts()) {
            return false;
        }
        const graph_token = await this.#am.getToken(
            this.#am.getRegistered()[0],
        );
        const grants = jwt_get_payload(graph_token);
        if ((!"deviceid") in grants) {
            ssoLog("access token does not have deviceid grant");
            return false;
        }
        const response = await fetch(
            `https://graph.microsoft.com/v1.0/devices(deviceId='{${grants["deviceid"]}}')?$select=isCompliant,displayName`,
            {
                headers: {
                    Accept: "application/json",
                    Authorization: "Bearer " + graph_token,
                },
            },
        );
        if (!response.ok) {
            ssoLogError("failed to query device state");
            return false;
        }
        const data = await response.json();
        this.#last_refresh = Date.now();
        this.device = new Device(data.displayName, data.isCompliant);
        ssoLog("updated device information");
        return true;
    }

    getDevice() {
        return this.device;
    }
}
