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
    static DEFAULT_TIMEOUT_MS = 15 * 1000;

    #queue = [];

    register_handle(id, timeout_ms = RpcHandlerQueue.DEFAULT_TIMEOUT_MS) {
        const handle = {
            id: id,
            dfd: new Deferred(),
        };
        this.#queue.push(handle);
        const timeout = new Promise((_, reject) =>
            setTimeout(() => {
                this.#drop_handle(handle);
                reject(`timeout while waiting for ${id} response`);
            }, timeout_ms),
        );
        return Promise.race([handle.dfd.promise, timeout]);
    }

    resolve_handle(id, data) {
        this.#take_handle(id)?.dfd.resolve(data);
    }

    reject_handle(id, data) {
        this.#take_handle(id)?.dfd.reject(data);
    }

    /* Fail all outstanding requests, e.g. when the transport went away. */
    reject_all(data) {
        const pending = this.#queue;
        this.#queue = [];
        for (const hdl of pending) {
            hdl.dfd.reject(data);
        }
    }

    has_pending() {
        return this.#queue.length != 0;
    }

    /* Take the oldest handle for that id, as responses arrive in order. */
    #take_handle(id) {
        const idx = this.#queue.findIndex((hdl) => hdl.id == id);
        if (idx === -1) return null;
        return this.#queue.splice(idx, 1)[0];
    }

    #drop_handle(handle) {
        const idx = this.#queue.indexOf(handle);
        if (idx !== -1) this.#queue.splice(idx, 1);
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
    /* if set, the NM connection is kept alive permanently */
    #keep_connected = false;

    constructor(name, state_change_fn, keep_connected = false) {
        this.#name = name;
        this.#notify_fn = state_change_fn;
        this.#keep_connected = keep_connected;
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
        if (this.#keep_connected) return;
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
