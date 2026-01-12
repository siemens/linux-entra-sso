/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { PlatformFirefox } from "./platform-firefox.js";

export class PlatformThunderbird extends PlatformFirefox {
    browser = "Thunderbird";

    transform_ui_title(title) {
        return title.split(/[@(]/)[0].trim();
    }
}
