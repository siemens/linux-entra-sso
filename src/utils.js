/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export function ssoLog(message) {
    console.log("[Linux Entra SSO]", message);
}

export function ssoLogError(message) {
    console.error("[Linux Entra SSO]", message);
}

export async function load_icon(path, width) {
    const response = await fetch(chrome.runtime.getURL(path));
    let imgBitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: width,
        resizeHeight: width,
    });
    let canvas = new OffscreenCanvas(width, width);
    let ctx = canvas.getContext("2d");
    ctx.save();
    ctx.drawImage(imgBitmap, 0, 0);
    ctx.restore();
    return ctx.getImageData(0, 0, width, width);
}

export function jwt_get_payload(token) {
    var base64Url = token.split(".")[1];
    var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    var jsonPayload = decodeURIComponent(
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
