/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, load_icon } from "./utils.js";
import { Deferred } from "./utils.js";

export class Account {
    #broker_obj = null;
    #avatar_imgdata = null;
    avatar = null;

    constructor(broker_obj) {
        this.#broker_obj = { ...broker_obj };
    }

    name() {
        return this.#broker_obj.name;
    }

    username() {
        return this.#broker_obj.username;
    }

    brokerObject() {
        return this.#broker_obj;
    }

    toMenuObject() {
        return {
            name: this.name(),
            username: this.username(),
            avatar: this.avatar,
        };
    }

    async getAvatarImgData() {
        if (!this.#avatar_imgdata) {
            this.#avatar_imgdata = await load_icon(
                "/icons/profile-outline_48.png",
                48,
            );
        }
        return this.#avatar_imgdata;
    }

    setAvatarImgData(data) {
        this.#avatar_imgdata = data;
    }

    async getDecoratedAvatar(color, width) {
        let imgdata = await this.getAvatarImgData();
        const sWidth = imgdata.width;
        const lineWidth = Math.min(2, width / 12);
        let buffer = new OffscreenCanvas(sWidth, sWidth);
        let ctx_buffer = buffer.getContext("2d");
        ctx_buffer.putImageData(imgdata, 0, 0);

        let canvas = new OffscreenCanvas(width, width);
        let ctx = canvas.getContext("2d");
        ctx.save();
        const img_margin = color === null ? 0 : lineWidth + 1;
        ctx.beginPath();
        ctx.arc(
            width / 2,
            width / 2,
            width / 2 - img_margin,
            0,
            Math.PI * 2,
            false,
        );
        ctx.clip();
        ctx.drawImage(
            buffer,
            0,
            0,
            sWidth,
            sWidth,
            img_margin,
            img_margin,
            width - img_margin * 2,
            width - img_margin * 2,
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
}

export class AccountManager {
    #broker = null;
    #graph_token = null;
    #registered = [];
    #active = null;
    #queried = false;

    constructor(broker) {
        this.#broker = broker;
    }

    hasAccounts() {
        return this.#registered.length != 0;
    }

    /**
     * @returns if we got account data from the broker
     */
    hasBrokerData() {
        return this.#queried;
    }

    getActive() {
        return this.#active;
    }

    getRegistered() {
        return this.#registered;
    }

    async loadAccounts() {
        if (this.hasBrokerData()) return;

        ssoLog("loading accounts");
        const _accounts = await this.#broker.getAccounts();
        if (!_accounts) return;
        this.#registered = _accounts;
        this.#active = _accounts[0];
        ssoLog("active account: " + this.#active.username());

        // load profile picture and set it as icon
        if (
            !this.#graph_token ||
            this.#graph_token.expiresOn < Date.now() + 60000
        ) {
            this.#graph_token = await this.#broker.acquireTokenSilently(
                this.#active,
            );
            if ("error" in this.#graph_token) {
                ssoLog("couldn't acquire API token for avatar:");
                console.log(this.#graph_token.error);
                return;
            }
            ssoLog("API token acquired");
        }
        const response = await fetch(
            "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
            {
                headers: {
                    Accept: "image/jpeg",
                    Authorization: "Bearer " + this.#graph_token.accessToken,
                },
            },
        );
        if (response.ok) {
            let avatar = await createImageBitmap(await response.blob());
            let canvas = new OffscreenCanvas(48, 48);
            let ctx = canvas.getContext("2d");
            ctx.save();
            ctx.beginPath();
            ctx.arc(24, 24, 24, 0, Math.PI * 2, false);
            ctx.clip();
            ctx.drawImage(avatar, 0, 0);
            ctx.restore();
            /* serialize image to data URL (ugly, but portable) */
            let blob = await canvas.convertToBlob();
            const dataUrl = await new Promise((r) => {
                let a = new FileReader();
                a.onload = r;
                a.readAsDataURL(blob);
            }).then((e) => e.target.result);

            /* store image data */
            ctx.clearRect(0, 0, 48, 48);
            ctx.drawImage(avatar, 0, 0, 48, 48);
            this.#active.setAvatarImgData(ctx.getImageData(0, 0, 48, 48));
            this.#active.avatar = dataUrl;
        } else {
            ssoLog("Warning: Could not get profile picture.");
        }
    }

    /*
     * Store the current state in the local storage.
     * To not leak account data in disabled state, we clear the account object.
     */
    async persist(sso_state) {
        let ssostate = {
            state: sso_state,
            account:
                sso_state && this.#active !== null
                    ? this.#active.brokerObject()
                    : null,
        };
        return chrome.storage.local.set({ ssostate });
    }

    async restore() {
        let dfd = new Deferred();
        chrome.storage.local.get("ssostate", (data) => {
            let state_active = true;
            if (data.ssostate) {
                state_active = data.ssostate.state;
                if (
                    state_active &&
                    data.ssostate.account &&
                    !this.hasAccounts()
                ) {
                    this.#registered = [new Account(data.ssostate.account)];
                    this.#active = this.#registered[0];
                    ssoLog(
                        "temporarily using last-known account: " +
                            this.#active.username(),
                    );
                }
            }
            dfd.resolve(state_active);
        });
        return dfd.promise;
    }
}
