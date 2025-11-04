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
    #am = null;
    device = null;

    constructor(account_manager) {
        this.#am = account_manager;
        this.device = null;
    }

    async loadDeviceInfo() {
        if (!this.#am.hasAccounts()) {
            return;
        }
        const graph_token = await this.#am.getToken(
            this.#am.getRegistered()[0],
        );
        const grants = jwt_get_payload(graph_token);
        if ((!"deviceid") in grants) {
            ssoLog("access token does not have deviceid grant");
            return;
        }
        ssoLog(grants["deviceid"]);
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
            return;
        }
        const data = await response.json();
        this.device = new Device(data.displayName, data.isCompliant);
    }

    getDevice() {
        return this.device;
    }
}
