/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { getLogger, load_icon, decorate_icon } from "./utils.js";
import { DEFAULT_STORE } from "./account.js";

const log = getLogger("platform");

export class Platform {
    static SSO_URL = "https://login.microsoftonline.com";

    browser;

    host_versions = {
        native: null,
        broker: null,
    };

    /* references needed for PRT injection */
    account = null;
    /* resolves {active, account} for a cookie store; used for per-container SSO */
    resolve_injection = null;
    /* invoked when the active tab's container changes (container platforms only) */
    on_container_change = null;
    well_known_app_filters = [];
    sso_url_permitted = true;

    /* invoked with (text, is_error) to surface platform issues in the UI */
    #status_handler = null;

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
        // If we already know the versions for this session (restored from
        // session storage), do not query the broker again: getVersion is a
        // broker RPC that would re-activate the broker via D-Bus.
        await this.#restore();
        if (this.host_versions.native !== null) {
            return;
        }
        this.host_versions = await broker.getVersion();
        await this.#persist();
    }

    /*
     * Persist the host and broker versions in the session storage.
     */
    async #persist() {
        return chrome.storage.session.set({
            host_versions: this.host_versions,
        });
    }

    async #restore() {
        const data = await chrome.storage.session.get("host_versions");
        if (!data.host_versions) return;
        this.host_versions = data.host_versions;
    }

    setIconDisabled() {
        chrome.action.setIcon({
            path: {
                48: "/icons/linux-entra-sso_48.png",
                128: "/icons/linux-entra-sso_128.png",
            },
        });
    }

    /* Disabled icon as ImageData, optionally ringed with a container color. */
    async getDisabledIconData(width, color) {
        const imgdata = await load_icon(
            "/icons/linux-entra-sso_128.png",
            width,
        );
        return decorate_icon(imgdata, width, color);
    }

    /**
     * Can be overwritten to shorten the title on platforms that print the
     * title next to the icon (instead of in a tooltip).
     */
    transform_ui_title(title) {
        return title;
    }

    getSsoUrl() {
        return Platform.SSO_URL;
    }

    /* Cookie store of the currently active tab; platforms without containers
     * always report the default store. */
    get_current_store() {
        return DEFAULT_STORE;
    }

    /* Color of the active tab's container, or null when there is none. */
    get_current_container_color() {
        return null;
    }

    /* Register a callback fired when the active tab's container changes. */
    set_container_change_handler(handler) {
        this.on_container_change = handler;
    }

    set_status_handler(handler) {
        this.#status_handler = handler;
    }

    /* Surface a platform error in the UI (action badge and menu message). */
    report_error(text) {
        log.error(text);
        this.#status_handler?.(text, true);
    }

    /* Withdraw a previously reported error. */
    clear_error() {
        this.#status_handler?.(null);
    }

    update_request_handlers(enabled, account, broker, resolve = null) {
        this.account = account;
        this.resolve_injection = resolve;
    }

    async update_host_permissions() {
        const currentPermissions = await chrome.permissions.getAll();
        this.well_known_app_filters = currentPermissions.origins;

        // check if we have access to the SSO url
        const permissionsToCheck = {
            origins: [Platform.SSO_URL + "/*"],
        };
        const result = await chrome.permissions.contains(permissionsToCheck);
        this.sso_url_permitted = result;
    }
}
