/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform-abstraction.js";

export class PlatformFirefox extends Platform {
    browser = "Firefox";

    isLike(_browser) {
        if (["Firefox", "Thunderbird"].includes(this.browser)) return true;
        return super.isLike(_browser);
    }
}

export function create_platform() {
    return new PlatformFirefox();
}
