/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { PlatformFirefox } from "./platform-firefox.js";

export function create_platform() {
    return new PlatformFirefox();
}
