/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export function ssoLog(message) {
    console.log("[Linux Entra SSO] " + message);
}

export function ssoLogError(message) {
    console.error("[Linux Entra SSO] " + message);
}

/**
 * Promise that can externally be resolved or rejected.
 */
export class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.reject = reject;
            this.resolve = resolve;
        });
    }
}
