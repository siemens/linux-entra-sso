/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { getLogger, load_icon } from "./utils.js";
import { StateMachine } from "./state-machine.js";

const log = getLogger("accounts");

/* refresh the token if only x time is left */
const TOKEN_MIN_VALIDITY_MS = 60 * 1000;

/* key for tabs not assigned to any container; platforms map their own value */
export const DEFAULT_STORE = "default";

/*
 * Whether the user wants SSO. UNKNOWN means that no explicit choice was
 * recorded yet, which counts as active.
 */
export const SsoState = Object.freeze({
    UNKNOWN: "unknown",
    LOGGED_IN: "logged-in",
    LOGGED_OUT: "logged-out",
});

const SSO_TRANSITIONS = Object.freeze({
    [SsoState.UNKNOWN]: [SsoState.LOGGED_IN, SsoState.LOGGED_OUT],
    [SsoState.LOGGED_IN]: [SsoState.LOGGED_OUT],
    [SsoState.LOGGED_OUT]: [SsoState.LOGGED_IN],
});

class SsoStateMachine extends StateMachine {
    constructor(store) {
        super(`sso-state:${store}`, SSO_TRANSITIONS, SsoState.UNKNOWN);
    }

    is_active() {
        return !this.is_in(SsoState.LOGGED_OUT);
    }

    log_in() {
        return this.transition(SsoState.LOGGED_IN);
    }

    log_out() {
        return this.transition(SsoState.LOGGED_OUT);
    }
}

/*
 * Where the registered accounts come from. UNKNOWN means that we did not
 * determine it yet. PROVISIONAL data is the last-known set restored from
 * disk, which carries no tokens and is replaced once the broker answers.
 */
export const AccountsState = Object.freeze({
    UNKNOWN: "unknown",
    PROVISIONAL: "provisional",
    AUTHORITATIVE: "authoritative",
});

const ACCOUNTS_TRANSITIONS = Object.freeze({
    [AccountsState.UNKNOWN]: [
        AccountsState.PROVISIONAL,
        AccountsState.AUTHORITATIVE,
    ],
    [AccountsState.PROVISIONAL]: [AccountsState.AUTHORITATIVE],
    [AccountsState.AUTHORITATIVE]: [],
});

class AccountsStateMachine extends StateMachine {
    constructor() {
        super("accounts-state", ACCOUNTS_TRANSITIONS, AccountsState.UNKNOWN);
    }

    is_authoritative() {
        return this.is_in(AccountsState.AUTHORITATIVE);
    }

    is_provisional() {
        return this.is_in(AccountsState.PROVISIONAL);
    }

    restored_from_disk() {
        return this.transition(AccountsState.PROVISIONAL);
    }

    confirmed_by_broker() {
        return this.transition(AccountsState.AUTHORITATIVE);
    }
}

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

    async getDecoratedAvatar(width) {
        let imgdata = await this.getAvatarImgData();
        const sWidth = imgdata.width;
        const lineWidth = Math.min(2, width / 12);
        let buffer = new OffscreenCanvas(sWidth, sWidth);
        let ctx_buffer = buffer.getContext("2d");
        ctx_buffer.putImageData(imgdata, 0, 0);

        let canvas = new OffscreenCanvas(width, width);
        let ctx = canvas.getContext("2d");
        ctx.save();
        ctx.beginPath();
        ctx.arc(width / 2, width / 2, width / 2, 0, Math.PI * 2, false);
        ctx.clip();
        ctx.drawImage(buffer, 0, 0, sWidth, sWidth, 0, 0, width, width);
        ctx.restore();
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
    #accounts = new AccountsStateMachine();
    /* per cookie store (container) SSO binding: {sso, username} */
    #bindings = new Map();
    /* read-only fallback for containers without an explicit binding */
    #fallback = { sso: new SsoStateMachine(DEFAULT_STORE), username: null };
    /* in-flight token requests, keyed by username, to dedup concurrent calls */
    #token_requests = new Map();

    hasAccounts() {
        return this.#registered.length != 0;
    }

    /**
     * @returns if we got account data from the broker
     */
    hasBrokerData() {
        return this.#accounts.is_authoritative();
    }

    /**
     * @returns if the accounts are the last-known set from disk, which is
     * used until the broker confirms the real one
     */
    hasProvisionalData() {
        return this.#accounts.is_provisional();
    }

    /*
     * Resolve the binding for a container, falling back to the default
     * container and finally to the implicit "SSO on, nothing selected" state.
     */
    #resolve(store = DEFAULT_STORE) {
        return (
            this.#bindings.get(store) ??
            this.#bindings.get(DEFAULT_STORE) ??
            this.#fallback
        );
    }

    /* Build a container binding backed by its own SSO state machine. */
    #makeBinding(enabled = true, username = null, store = DEFAULT_STORE) {
        const sso = new SsoStateMachine(store);
        if (!enabled) sso.log_out();
        return { sso, username };
    }

    /* Materialize an explicit binding for a container, seeded from the fallback. */
    #ensure(store) {
        let binding = this.#bindings.get(store);
        if (!binding) {
            const base = this.#resolve(store);
            binding = this.#makeBinding(
                base.sso.is_active(),
                base.username,
                store,
            );
            this.#bindings.set(store, binding);
        }
        return binding;
    }

    /* Mirror Account.active to the default container for the tray/menu UI. */
    #syncDefaultActiveFlags() {
        const selected = this.#resolve(DEFAULT_STORE).username;
        for (const a of this.#registered) a.active = a.username() == selected;
    }

    /* Drop selections pointing to accounts the broker no longer knows. */
    #reconcileBindings() {
        for (const binding of this.#bindings.values()) {
            if (
                binding.username &&
                !this.#registered.find((a) => a.username() == binding.username)
            ) {
                binding.username = null;
            }
        }
    }

    getActive(store = DEFAULT_STORE) {
        const { username } = this.#resolve(store);
        if (!username) return undefined;
        return this.#registered.find((a) => a.username() == username);
    }

    /**
     * @returns if SSO is active for the container (i.e. not explicitly disabled)
     */
    isActive(store = DEFAULT_STORE) {
        return this.#resolve(store).sso.is_active();
    }

    setActive(active, store = DEFAULT_STORE) {
        const { sso } = this.#ensure(store);
        if (active) sso.log_in();
        else sso.log_out();
    }

    getRegistered() {
        return this.#registered;
    }

    logout(store = DEFAULT_STORE) {
        this.#ensure(store).username = null;
        if (store === DEFAULT_STORE) this.#syncDefaultActiveFlags();
    }

    selectAccount(username, store = DEFAULT_STORE) {
        let account;
        if (!username) {
            account = this.#registered[0];
            if (!account) return undefined;
        } else {
            account = this.#registered.find((a) => a.username() == username);
            if (account === undefined) {
                log.warn("no account found with username " + username);
                return undefined;
            }
        }
        this.#ensure(store).username = account.username();
        if (store === DEFAULT_STORE) this.#syncDefaultActiveFlags();
        return account;
    }

    async loadAccounts(broker) {
        if (this.hasBrokerData()) return;

        const _accounts = await broker.getAccounts();
        if (!_accounts?.length) {
            this.#registered = [];
            /* an empty result is still an answer: no account is registered */
            if (_accounts) this.#accounts.confirmed_by_broker();
            this.#reconcileBindings();
            return;
        }
        // remember the current selection and avatars before replacing the
        // accounts with the freshly queried ones.
        const last_username = this.getActive()?.username();
        const previous_avatars = new Map(
            this.#registered.map((a) => [a.username(), a.avatar]),
        );

        /* we successfully got account data from the broker */
        this.#registered = _accounts;
        this.#accounts.confirmed_by_broker();

        // carry over the avatars so the UI does not flash the default icon
        // while the profile pictures are refetched below.
        for (const account of this.#registered) {
            account.avatar = previous_avatars.get(account.username()) ?? null;
        }

        // drop selections that point to accounts the broker no longer knows
        this.#reconcileBindings();

        // only auto-select for the default container, and only if not disabled
        const def = this.#ensure(DEFAULT_STORE);
        if (!def.sso.is_active()) {
            log.info("SSO is disabled, not selecting an account");
        } else if (def.username) {
            log.info("keep selected account: " + def.username);
        } else if (last_username && this.selectAccount(last_username)) {
            log.info(
                "select previously used account: " +
                    this.getActive().username(),
            );
        } else {
            this.selectAccount();
            log.info("select first account: " + this.getActive().username());
        }
        this.#syncDefaultActiveFlags();

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
            log.info("API token acquired for " + account.username());
            account.access_token = graph_token.accessToken;
            account.access_token_exp = graph_token.expiresOn;
            return account.access_token;
        } catch (error) {
            log.error(
                "failed to acquire API token for " + account.username(),
                error,
            );
            /* do not keep a token the broker refused to renew */
            account.access_token = null;
            account.access_token_exp = 0;
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
            log.warn("could not get profile picture of " + account.username());
        }
    }

    /* Serialize the per-container bindings to a plain object for storage. */
    #serializeBindings() {
        const obj = {};
        for (const [store, b] of this.#bindings) {
            obj[store] = { enabled: b.sso.is_active(), username: b.username };
        }
        return obj;
    }

    /*
     * Rebuild the bindings map from stored data. Understands the new
     * per-container format and migrates the legacy single-state format
     * (a global `state` flag plus a selected account) to the default
     * container. For legacy session data the enabled flag is derived from
     * whether an account was selected, matching the previous behavior.
     */
    #restoreBindings(obj, enabledFromSelection) {
        const map = new Map();
        if (obj.bindings) {
            for (const [store, b] of Object.entries(obj.bindings)) {
                map.set(
                    store,
                    this.#makeBinding(
                        Boolean(b.enabled),
                        b.username ?? null,
                        store,
                    ),
                );
            }
            return map;
        }
        const selected =
            obj.accounts?.find((s) => s.active)?.broker_obj?.username ?? null;
        const enabled = enabledFromSelection
            ? selected != null
            : (obj.state ?? true);
        map.set(DEFAULT_STORE, this.#makeBinding(enabled, selected));
        return map;
    }

    /*
     * Store the current state in the local storage.
     * To not leak account data in disabled state, we clear the account object.
     */
    async persist() {
        if (!this.hasAccounts()) return;
        const bindings = this.#serializeBindings();
        const in_use = [...this.#bindings.values()].some(
            (b) => b.sso.is_active() && b.username,
        );
        const ssostate = {
            bindings,
            accounts: in_use ? this.#registered.map((a) => a.toSerial()) : [],
        };
        const appstate = {
            broker_queried: this.hasBrokerData(),
            bindings,
            accounts: this.#registered.map((a) => a.toSerial(true)),
        };
        return Promise.all([
            chrome.storage.local.set({ ssostate }),
            chrome.storage.session.set({ account_manager: appstate }),
        ]);
    }

    /*
     * Drop account data cached on disk, but keep the disabled default binding.
     */
    async #wipeCachedAccounts() {
        return chrome.storage.local.set({
            ssostate: {
                bindings: {
                    [DEFAULT_STORE]: { enabled: false, username: null },
                },
                accounts: [],
            },
        });
    }

    async restore() {
        const [data, sessionData] = await Promise.all([
            chrome.storage.local.get("ssostate"),
            chrome.storage.session.get("account_manager"),
        ]);
        const sess = sessionData.account_manager;
        if (sess) {
            this.#registered = (sess.accounts ?? []).map((a) =>
                Account.fromSerial(a),
            );
            this.#bindings = this.#restoreBindings(sess, true);
            if (sess.broker_queried) {
                this.#accounts.confirmed_by_broker();
            } else if (this.#registered.length > 0) {
                this.#accounts.restored_from_disk();
            }
        }
        /* restored from session */
        if (this.#registered.length > 0) {
            this.#syncDefaultActiveFlags();
            return;
        }

        /* no accounts in session, try restore from local storage */
        const ss = data.ssostate;
        if (!ss) {
            log.info("no preserved state found");
            // if the SSO is not explicitly disabled, we assume it is on.
            return;
        }
        this.#bindings = this.#restoreBindings(ss, false);
        const any_enabled = [...this.#bindings.values()].some((b) =>
            b.sso.is_active(),
        );
        if (!any_enabled) {
            await this.#wipeCachedAccounts();
            return;
        }
        if (ss.accounts?.length) {
            this.#registered = ss.accounts.map((a) => Account.fromSerial(a));
            this.#accounts.restored_from_disk();
        }
        this.#syncDefaultActiveFlags();
        const active_acc = this.getActive();
        if (active_acc) {
            log.info(
                "temporarily using last-known account: " +
                    active_acc.username(),
            );
        }
    }
}
