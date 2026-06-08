/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

import { ssoLog, ssoLogError, Deferred } from "./utils.js";
import { Account } from "./account.js";

/**
 * Queue to resolve promises, once the data arrives from the
 * remote backend.
 */
export class RpcHandlerQueue {
    #queue = [];

    register_handle(id) {
        const handle = {
            id: id,
            dfd: new Deferred(),
        };
        this.#queue.push(handle);
        return handle.dfd.promise;
    }

    resolve_handle(id, data) {
        const idx = this.#queue.findIndex((hdl) => hdl.id == id);
        if (idx !== -1) {
            this.#queue[idx].dfd.resolve(data);
            this.#queue.splice(idx, 1);
        }
    }

    reject_handle(id, data) {
        const idx = this.#queue.findIndex((hdl) => hdl.id == id);
        if (idx !== -1) {
            this.#queue[idx].dfd.reject(data);
            this.#queue.splice(idx, 1);
        }
    }
}

export class Broker {
    static IDLE_DISCONNECT_MS = 10 * 1000;

    #name = null;
    #notify_fn = null;
    #port_native = null;
    #rpc_queue = new RpcHandlerQueue();
    /* assume the broker is running until we know */
    #online = true;
    /* track if the NM connection was successful */
    #conn_error = false;
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
            this.#port_native = null;
            if (chrome.runtime.lastError) {
                ssoLogError(
                    "Error in native application connection: " +
                        chrome.runtime.lastError.message,
                );
                this.#conn_error = true;
            } else {
                ssoLogError("Native application connection closed.");
            }
            this.#notify_fn(false);
        });
        this.#port_native.onMessage.addListener(
            this.#on_message_native.bind(this),
        );
        this.#reset_idle_timer();
        ssoLog("connected to host tooling");
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
            ssoLog("disconnecting from host tooling after inactivity");
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
        return !this.#conn_error;
    }

    isRunning() {
        return !this.#conn_error && this.#online;
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

    #on_message_native(response) {
        /* handle events (not an RPC response) */
        if (response.command == "brokerStateChanged") {
            if (response.message == "online") this.#online = true;
            else this.#online = false;
            this.#notify_fn(this.#online);
            return;
        }

        /* on rpc messages, reject all responses that have errors */
        if ("error" in response.message) {
            this.#rpc_queue.reject_handle(response.command, {
                ...response.message.error,
            });
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
                this.#rpc_queue.reject_handle("acquireTokenSilently", {
                    ...response.message.brokerTokenResponse.error,
                });
            } else {
                this.#rpc_queue.resolve_handle("acquireTokenSilently", {
                    ...response.message.brokerTokenResponse,
                });
            }
        } else {
            ssoLog("unknown command: " + response.command);
        }
    }
}
