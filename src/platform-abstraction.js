/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export class Platform {
    browser;

    /* references needed for PRT injection */
    broker = null;
    account = null;

    setIconDisabled() {
        chrome.action.setIcon({
            path: {
                48: "/icons/linux-entra-sso_48.png",
                128: "/icons/linux-entra-sso_128.png",
            },
        });
    }
}
