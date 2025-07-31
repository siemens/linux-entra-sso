/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export class Platform {
    browser;

    isLike(_browser) {
        return this.browser == _browser;
    }
}
