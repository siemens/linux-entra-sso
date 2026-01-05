/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Deferred } from "./utils.js";

export class Platform {
    static SSO_URL = "https://login.microsoftonline.com";

    browser;

    host_versions = {
        native: null,
        broker: null,
    };

    /* references needed for PRT injection */
    broker = null;
    account = null;
    well_known_app_filters = [];
    sso_url_permitted = true;

    constructor() {
        /*
         * The WebRequest API operates on allowed URLs only.
         * To intercept a sub-resource request (e.g. from an iframe), the extension
         * must have access to both the requested URL and its initiator.
         */
        this.well_known_app_filters = [Platform.SSO_URL + "/*"];
    }

    /**
     * Load platform information from backend.
     */
    async setup(broker) {
        try {
            this.host_versions = await broker.getVersion();
        } catch (error) {
            ssoLog(error);
        }
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: {
                48: "/icons/linux-entra-sso_48.png",
                128: "/icons/linux-entra-sso_128.png",
            },
        });
    }

    getSsoUrl() {
        return Platform.SSO_URL;
    }

    update_request_handlers(enabled, account, broker) {
        this.broker = broker;
        this.account = account;
    }

    async update_host_permissions() {
        const currentPermissions = await chrome.permissions.getAll();
        this.well_known_app_filters = currentPermissions.origins;

        // check if we have access to the SSO url
        let dfd = new Deferred();
        const permissionsToCheck = {
            origins: [Platform.SSO_URL + "/*"],
        };
        chrome.permissions.contains(permissionsToCheck).then((result) => {
            this.sso_url_permitted = result;
            dfd.resolve();
        });
        await dfd.promise;
    }
}
