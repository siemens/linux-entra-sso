/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { PlatformThunderbird } from "./platform-thunderbird.js";

export function create_platform() {
    return new PlatformThunderbird();
}
