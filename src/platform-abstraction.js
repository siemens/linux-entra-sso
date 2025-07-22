/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export class Platform {
    static SSO_URL = "https://login.microsoftonline.com";

    browser;

    /* references needed for PRT injection */
    broker = null;
    account = null;
    well_known_app_filters = [];

    constructor() {
        /*
         * The WebRequest API operates on allowed URLs only.
         * To intercept a sub-resource request (e.g. from an iframe), the extension
         * must have access to both the requested URL and its initiator.
         */
        this.well_known_app_filters = [Platform.SSO_URL + "/*"];
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
    }
}
