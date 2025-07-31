/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform-abstraction.js";

export class PlatformFirefox extends Platform {
    browser = "Firefox";

    setIconDisabled() {
        chrome.action.setIcon({
            path: "/icons/linux-entra-sso.svg",
        });
    }
}

export function create_platform() {
    return new PlatformFirefox();
}
