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

/*
 * Render an icon (given as ImageData) into a width x width image, optionally
 * ringed by a colored circle. A null color returns the icon unchanged.
 */
export function decorate_icon(imgdata, width, color = null) {
    const sWidth = imgdata.width;
    const lineWidth = Math.min(2, width / 12);
    const buffer = new OffscreenCanvas(sWidth, sWidth);
    buffer.getContext("2d").putImageData(imgdata, 0, 0);

    const canvas = new OffscreenCanvas(width, width);
    const ctx = canvas.getContext("2d");
    ctx.save();
    // inset the picture so the ring is drawn around it, not over it
    const margin = color === null ? 0 : lineWidth + 1;
    ctx.beginPath();
    ctx.arc(width / 2, width / 2, width / 2 - margin, 0, Math.PI * 2, false);
    ctx.clip();
    ctx.drawImage(
        buffer,
        0,
        0,
        sWidth,
        sWidth,
        margin,
        margin,
        width - margin * 2,
        width - margin * 2,
    );
    ctx.restore();
    if (color === null) {
        return ctx.getImageData(0, 0, width, width);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(
        width / 2,
        width / 2,
        width / 2 - Math.min(1, lineWidth / 2),
        0,
        Math.PI * 2,
        false,
    );
    ctx.stroke();
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
