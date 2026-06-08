/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, load_icon, ssoLogError } from "./utils.js";

/* refresh the token if only x time is left */
const TOKEN_MIN_VALIDITY_MS = 60 * 1000;

export class Account {
    #broker_obj = null;
    /* ImageData cache for the tray icon (not serialized) */
    #avatar_imgdata = null;
    /* circular avatar as a serializable data URL; null => default icon */
    avatar = null;
    active = false;
    access_token = null;
    access_token_exp = 0;

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
        if (this.#avatar_imgdata) {
            return this.#avatar_imgdata;
        }
        if (!this.avatar) {
            this.#avatar_imgdata = await load_icon(
                "/icons/profile-outline_48.png",
                48,
            );
            return this.#avatar_imgdata;
        }
        /* derive ImageData from the serializable data URL */
        const bitmap = await createImageBitmap(
            await (await fetch(this.avatar)).blob(),
        );
        const canvas = new OffscreenCanvas(48, 48);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, 48, 48);
        this.#avatar_imgdata = ctx.getImageData(0, 0, 48, 48);
        return this.#avatar_imgdata;
    }

    setAvatar(dataUrl) {
        this.avatar = dataUrl;
        /* clear cache, will be rebuild on next getAvatarImgData */
        this.#avatar_imgdata = null;
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

    toSerial(with_secrets = false) {
        const serial = {
            broker_obj: this.brokerObject(),
            active: this.active,
            avatar: this.avatar,
        };
        if (with_secrets) {
            serial.access_token = this.access_token;
            serial.access_token_exp = this.access_token_exp;
        }
        return serial;
    }

    static fromSerial(serial) {
        let acc = new Account(serial.broker_obj);
        acc.active = serial.active;
        acc.avatar = serial.avatar ?? null;
        acc.access_token = serial.access_token ?? null;
        acc.access_token_exp = serial.access_token_exp ?? 0;
        return acc;
    }
}

export class AccountManager {
    #registered = [];
    #queried = false;
    /* in-flight token requests, keyed by username, to dedup concurrent calls */
    #token_requests = new Map();

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

    async loadAccounts(broker) {
        if (this.hasBrokerData()) return;

        ssoLog("loading accounts");
        let _accounts = [];
        try {
            _accounts = await broker.getAccounts();
        } catch (error) {
            ssoLog(error);
        }
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

        /* we successfully got account data from the broker */
        this.#queried = true;

        await Promise.all(
            this.#registered.map((a) => this.loadProfilePicture(broker, a)),
        );
    }

    async getToken(broker, account) {
        if (Date.now() + TOKEN_MIN_VALIDITY_MS < account.access_token_exp) {
            return account.access_token;
        }
        const username = account.username();
        /* coalesce concurrent requests for the same account */
        let request = this.#token_requests.get(username);
        if (request) {
            return request;
        }
        request = this.#acquireToken(broker, account);
        this.#token_requests.set(username, request);
        try {
            return await request;
        } finally {
            this.#token_requests.delete(username);
        }
    }

    async #acquireToken(broker, account) {
        try {
            const graph_token = await broker.acquireTokenSilently(account);
            ssoLog("API token acquired for " + account.username());
            account.access_token = graph_token.accessToken;
            account.access_token_exp = graph_token.expiresOn;
            return account.access_token;
        } catch (error) {
            ssoLog(error);
            return null;
        }
    }

    async loadProfilePicture(broker, account) {
        const graph_token = await this.getToken(broker, account);
        if (!graph_token) return;
        const response = await fetch(
            "https://graph.microsoft.com/v1.0/me/photos/48x48/$value",
            {
                headers: {
                    Accept: "image/jpeg",
                    Authorization: "Bearer " + graph_token,
                },
            },
        );
        if (response.ok) {
            let avatar = await createImageBitmap(await response.blob());
            let canvas = new OffscreenCanvas(48, 48);
            let ctx = canvas.getContext("2d");
            ctx.beginPath();
            ctx.arc(24, 24, 24, 0, Math.PI * 2, false);
            ctx.clip();
            ctx.drawImage(avatar, 0, 0, 48, 48);
            /* serialize image to data URL (ugly, but portable) */
            let blob = await canvas.convertToBlob();
            const dataUrl = await new Promise((r) => {
                let a = new FileReader();
                a.onload = r;
                a.readAsDataURL(blob);
            }).then((e) => e.target.result);
            account.setAvatar(dataUrl);
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
        const ssostate = {
            state: this.getActive() != null,
            accounts: this.getActive()
                ? this.#registered.map((a) => a.toSerial())
                : [],
        };
        const appstate = {
            broker_queried: this.#queried,
            accounts: this.#registered.map((a) => a.toSerial(true)),
        };
        return Promise.all([
            chrome.storage.local.set({ ssostate }),
            chrome.storage.session.set({ account_manager: appstate }),
        ]);
    }

    async restore() {
        const [data, sessionData] = await Promise.all([
            chrome.storage.local.get("ssostate"),
            chrome.storage.session.get("account_manager"),
        ]);
        if (sessionData.account_manager) {
            this.#queried = sessionData.account_manager.broker_queried ?? false;
            this.#registered =
                sessionData.account_manager.accounts.map((a) =>
                    Account.fromSerial(a),
                ) ?? [];
        }
        /* restored from session */
        if (this.#registered.length > 0) {
            return this.getActive() != null;
        }

        /* no accounts in session, try restore from local storage */
        let active_acc = undefined;
        if (!data.ssostate) {
            ssoLog("no preserved state found");
            // if the SSO is not explicitly disabled, we assume it is on.
            return true;
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
        return state_active;
    }
}
