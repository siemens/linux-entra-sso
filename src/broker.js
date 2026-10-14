/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { getLogger, Deferred } from "./utils.js";
import { Account } from "./account.js";

const log = getLogger("broker");

/**
 * Queue to resolve promises, once the data arrives from the
 * remote backend.
 */
export class RpcHandlerQueue {
    /* how long the host may stay silent while requests are outstanding */
    static DEFAULT_TIMEOUT_MS = 15 * 1000;

    #queue = [];
    #timeout_ms;
    #watchdog = null;

    constructor(timeout_ms = RpcHandlerQueue.DEFAULT_TIMEOUT_MS) {
        this.#timeout_ms = timeout_ms;
    }

    /*
     * The host answers strictly in order, so a request can be queued behind
     * arbitrarily slow ones. Hence all outstanding requests share a watchdog
     * that is restarted on every answer, instead of each request carrying its
     * own deadline that already expires while the host still makes progress.
     */
    register_handle(id) {
        const handle = {
            id: id,
            dfd: new Deferred(),
        };
        this.#queue.push(handle);
        this.#kick_watchdog();
        log.debug(`registered handle for: ${id}`);
        return handle.dfd.promise;
    }

    resolve_handle(id, data) {
        log.debug(`resolving handle for: ${id}`);
        this.#take_handle(id)?.dfd.resolve(data);
        this.#kick_watchdog();
    }

    reject_handle(id, data) {
        log.debug(`rejecting handle for: ${id}`);
        this.#take_handle(id)?.dfd.reject(data);
        this.#kick_watchdog();
    }

    /* Fail all outstanding requests, e.g. when the transport went away. */
    reject_all(data) {
        const pending = this.#queue;
        this.#queue = [];
        this.#kick_watchdog();
        for (const hdl of pending) {
            hdl.dfd.reject(data);
        }
    }

    has_pending() {
        return this.#queue.some((hdl) => !hdl.expired);
    }

    /* Take the oldest handle for that id, as responses arrive in order. */
    #take_handle(id) {
        const idx = this.#queue.findIndex((hdl) => hdl.id == id);
        if (idx === -1) return null;
        return this.#queue.splice(idx, 1)[0];
    }

    #kick_watchdog() {
        if (this.#watchdog !== null) clearTimeout(this.#watchdog);
        this.#watchdog = null;
        if (!this.has_pending()) return;
        this.#watchdog = setTimeout(() => {
            this.#watchdog = null;
            /*
             * Responses are correlated by command only, so expired handles
             * stay queued to absorb the answers that might still arrive.
             * Dropping them would misalign all later ones.
             */
            for (const hdl of this.#queue) {
                hdl.expired = true;
                hdl.dfd.reject(`timeout while waiting for ${hdl.id} response`);
            }
        }, this.#timeout_ms);
    }
}

export class Broker {
    static IDLE_DISCONNECT_MS = 10 * 1000;

    #name = null;
    #notify_fn = null;
    #port_native = null;
    #rpc_queue = new RpcHandlerQueue();
    /* track if the NM connection was successful */
    #conn_error = false;
    /* track if we ever had a successful connection to the native app */
    #had_connection = false;
    #idle_timer = null;

    constructor(name, state_change_fn) {
        this.#name = name;
        this.#notify_fn = state_change_fn;
    }

    connect() {
        if (this.#port_native) {
            this.#reset_idle_timer();
            return;
        }
        this.#conn_error = false;
        this.#port_native = chrome.runtime.connectNative(this.#name);
        this.#port_native.onDisconnect.addListener(() => {
            /* note, that this is not called on .disconnect(), only on errors */
            this.#port_native = null;
            if (chrome.runtime.lastError) {
                log.error(
                    "error in native application connection: " +
                        chrome.runtime.lastError.message,
                );
                this.#conn_error = true;
            } else {
                /* Connection closed by the native application. */
                log.error("native application connection closed");
            }
            this.#rpc_queue.reject_all("lost connection to native application");
            this.#notify_fn(false);
        });
        this.#port_native.onMessage.addListener(
            this.#on_message_native.bind(this),
        );
        this.#reset_idle_timer();
    }

    disconnect() {
        this.#clear_idle_timer();
        if (!this.#port_native) return;

        this.#port_native.disconnect();
        this.#port_native = null;
        /* the next connection starts a host with a fresh response stream */
        this.#rpc_queue.reject_all("disconnected from native application");
    }

    /**
     * Ensure we are connected to the broker and (re)start the
     * inactivity timer. Must be called by every broker function.
     */
    #keep_alive() {
        this.connect();
        this.#reset_idle_timer();
    }

    #reset_idle_timer() {
        this.#clear_idle_timer();
        /* keep the connection alive to prevent the worker from shutting down */
        this.#idle_timer = setTimeout(() => {
            this.#idle_timer = null;
            /* never tear down the port while a response is still outstanding */
            if (this.#rpc_queue.has_pending()) {
                this.#reset_idle_timer();
                return;
            }
            log.debug("disconnecting from host tooling after inactivity");
            this.disconnect();
        }, Broker.IDLE_DISCONNECT_MS);
    }

    #clear_idle_timer() {
        if (this.#idle_timer !== null) {
            clearTimeout(this.#idle_timer);
            this.#idle_timer = null;
        }
    }

    isConnected() {
        /**
         * As we internally manage the lifecycle of the connection,
         * we only let the caller know if we are unable to connect to the host
         */
        return !this.#conn_error && this.#had_connection;
    }

    /**
     * @returns if connecting to the native application failed. Unlike
     * isConnected(), this is false while the connection is not established yet.
     */
    hasConnectionError() {
        return this.#conn_error;
    }

    /*
     * Persist the connection tracking state in the session storage.
     */
    async persist() {
        return chrome.storage.session.set({
            broker_state: { had_connection: this.#had_connection },
        });
    }

    async restore() {
        const data = await chrome.storage.session.get("broker_state");
        if (!data.broker_state) return;
        this.#had_connection = data.broker_state.had_connection ?? false;
    }

    getAccounts() {
        this.#keep_alive();
        this.#port_native.postMessage({ command: "getAccounts" });
        return this.#rpc_queue.register_handle("getAccounts");
    }

    async acquireTokenSilently(account) {
        this.#keep_alive();
        this.#port_native.postMessage({
            command: "acquireTokenSilently",
            account: account.brokerObject(),
        });
        return this.#rpc_queue.register_handle("acquireTokenSilently");
    }

    async acquirePrtSsoCookie(account, ssoUrl) {
        this.#keep_alive();
        this.#port_native.postMessage({
            command: "acquirePrtSsoCookie",
            account: account.brokerObject(),
            ssoUrl: ssoUrl,
        });
        return this.#rpc_queue.register_handle("acquirePrtSsoCookie");
    }

    async getVersion() {
        this.#keep_alive();
        this.#port_native.postMessage({ command: "getVersion" });
        return this.#rpc_queue.register_handle("getVersion");
    }

    /* Normalize the error from the native message into a readable string. */
    #stringify_error(error) {
        if (error !== null && typeof error === "object") {
            return JSON.stringify(error);
        }
        return error;
    }

    #on_message_native(response) {
        /* an answer is activity as well, so the idle window starts over */
        this.#reset_idle_timer();

        /* receiving any message proves the connection was successful */
        if (!this.#had_connection) {
            this.#had_connection = true;
            this.persist();
            log.info("connected to host tooling");
        }

        /* handle events (not an RPC response) */
        if (response.command == "brokerStateChanged") {
            this.#notify_fn(response.message == "online");
            return;
        }

        /* on rpc messages, reject all responses that have errors */
        if ("error" in response.message) {
            this.#rpc_queue.reject_handle(
                response.command,
                this.#stringify_error(response.message.error),
            );
            return;
        }

        if (response.command == "acquirePrtSsoCookie") {
            var cookieData = response.message;
            /* microsoft-identity-broker > 2.0.1 */
            if ("cookieItems" in cookieData) {
                cookieData = cookieData.cookieItems[0];
            }
            this.#rpc_queue.resolve_handle("acquirePrtSsoCookie", {
                cookieName: cookieData.cookieName,
                cookieContent: cookieData.cookieContent,
            });
        } else if (response.command == "getAccounts") {
            let _accounts = [];
            for (const a of response.message.accounts) {
                _accounts.push(new Account(a));
            }
            this.#rpc_queue.resolve_handle("getAccounts", _accounts);
        } else if (response.command == "getVersion") {
            this.#rpc_queue.resolve_handle("getVersion", {
                native: response.message.native,
                broker: response.message.linuxBrokerVersion,
            });
        } else if (response.command == "acquireTokenSilently") {
            if ("error" in response.message.brokerTokenResponse) {
                this.#rpc_queue.reject_handle(
                    "acquireTokenSilently",
                    this.#stringify_error(
                        response.message.brokerTokenResponse.error,
                    ),
                );
            } else {
                this.#rpc_queue.resolve_handle("acquireTokenSilently", {
                    ...response.message.brokerTokenResponse,
                });
            }
        } else {
            log.warn("unknown command: " + response.command);
        }
    }
}
