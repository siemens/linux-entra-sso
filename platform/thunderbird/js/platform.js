/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { Platform } from "./platform-abstraction.js";

export class PlatformThunderbird extends Platform {
    browser = "Thunderbird";
}

export function create_platform() {
    return new PlatformThunderbird();
}
