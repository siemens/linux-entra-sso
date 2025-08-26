/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { PlatformChrome } from "./platform-chrome.js";

export function create_platform() {
    return new PlatformChrome();
}
