/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

const LOG_PREFIX = "[Linux Entra SSO]";

/*
 * Component scoped logger. The level maps to the matching console
 * function, so the browser console can filter by severity.
 */
class Logger {
    #tag;

    constructor(component) {
        this.#tag = `[${component}]`;
    }

    debug(...args) {
        console.debug(LOG_PREFIX, this.#tag, ...args);
    }

    info(...args) {
        console.info(LOG_PREFIX, this.#tag, ...args);
    }

    warn(...args) {
        console.warn(LOG_PREFIX, this.#tag, ...args);
    }

    error(...args) {
        console.error(LOG_PREFIX, this.#tag, ...args);
    }
}

export function getLogger(component) {
    return new Logger(component);
}

export async function load_icon(path, width) {
    const response = await fetch(chrome.runtime.getURL(path));
    let imgBitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: width,
        resizeHeight: width,
    });
    const canvas = new OffscreenCanvas(width, width);
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.drawImage(imgBitmap, 0, 0);
    ctx.restore();
    return ctx.getImageData(0, 0, width, width);
}

export function jwt_get_payload(token) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
        atob(base64)
            .split("")
            .map(function (c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            })
            .join(""),
    );
    return JSON.parse(jsonPayload);
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
