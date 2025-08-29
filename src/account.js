/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, load_icon, ssoLogError } from "./utils.js";
import { Deferred } from "./utils.js";

export class Account {
    #broker_obj = null;
    #avatar_imgdata = null;
    avatar = null;
    active = false;

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
            active: this.active,
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

    toSerial() {
        return { broker_obj: this.brokerObject(), active: this.active };
    }

    static fromSerial(serial) {
        let acc = new Account(serial.broker_obj);
        acc.active = serial.active;
        return acc;
    }
}

export class AccountManager {
    #broker = null;
    #registered = [];
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
        return this.#registered.find((a) => a.active);
    }

    getRegistered() {
        return this.#registered;
    }

    logout() {
        this.#registered.map((a) => (a.active = false));
    }

    selectAccount(username) {
        if (!username) {
            let account = this.#registered[0];
            this.logout();
            account.active = true;
            return account;
        }
        const account = this.#registered.find((a) => a.username() == username);
        if (account === undefined) {
            ssoLog("no account found with username " + username);
            return undefined;
        }
        this.logout();
        account.active = true;
        return account;
    }

    async loadAccounts() {
        if (this.hasBrokerData()) return;

        ssoLog("loading accounts");
        const _accounts = await this.#broker.getAccounts();
        if (!_accounts || !_accounts.length) {
            this.#registered = [];
            return;
        }
        // if we already got an account from storage, select the
        // corresponding one from the broker as active.
        const last_username = this.getActive()?.username();
        this.#registered = _accounts;
        if (last_username && this.selectAccount(last_username)) {
            ssoLog(
                "select previously used account: " +
                    this.getActive().username(),
            );
        } else {
            this.selectAccount();
            ssoLog("select first account: " + this.getActive().username());
        }
        await Promise.all(
            this.#registered.map((a) => this.loadProfilePicture(a)),
        );
    }

    async loadProfilePicture(account) {
        const graph_token = await this.#broker.acquireTokenSilently(account);
        if ("error" in graph_token) {
            ssoLog("couldn't acquire API token for avatar:");
            console.log(graph_token.error);
            return;
        }
        ssoLog("API token acquired for " + account.username());
        const response = await fetch(
            "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
            {
                headers: {
                    Accept: "image/jpeg",
                    Authorization: "Bearer " + graph_token.accessToken,
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
            account.setAvatarImgData(ctx.getImageData(0, 0, 48, 48));
            account.avatar = dataUrl;
        } else {
            ssoLog(
                "Warning: Could not get profile picture of " +
                    account.username(),
            );
        }
    }

    /*
     * Store the current state in the local storage.
     * To not leak account data in disabled state, we clear the account object.
     */
    async persist() {
        if (!this.hasAccounts()) return;
        let ssostate = {
            state: this.getActive() != null,
            accounts: this.getActive()
                ? this.#registered.map((a) => a.toSerial())
                : [],
        };
        return chrome.storage.local.set({ ssostate });
    }

    async restore() {
        let dfd = new Deferred();
        chrome.storage.local.get("ssostate", (data) => {
            let active_acc = undefined;
            if (!data.ssostate) {
                ssoLog("no preserved state found");
                // if the SSO is not explicitly disabled, we assume it is on.
                dfd.resolve(true);
                return;
            }
            const state_active = data.ssostate.state;
            if (state_active && data.ssostate.accounts) {
                this.#registered = data.ssostate.accounts.map((a) =>
                    Account.fromSerial(a),
                );
                if (!state_active) this.logout();
                active_acc = this.getActive();
                if (active_acc) {
                    ssoLog(
                        "temporarily using last-known account: " +
                            active_acc.username(),
                    );
                }
            }
            dfd.resolve(state_active);
        });
        return dfd.promise;
    }
}
