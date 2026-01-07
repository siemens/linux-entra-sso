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
    #name = null;
    #notify_fn = null;
    #port_native = null;
    #rpc_queue = new RpcHandlerQueue();
    #online = false;

    constructor(name, state_change_fn) {
        this.#name = name;
        this.#notify_fn = state_change_fn;
    }

    connect() {
        this.#port_native = chrome.runtime.connectNative(this.#name);
        this.#port_native.onDisconnect.addListener(() => {
            this.#port_native = null;
            if (chrome.runtime.lastError) {
                ssoLogError(
                    "Error in native application connection: " +
                        chrome.runtime.lastError.message,
                );
            } else {
                ssoLogError("Native application connection closed.");
            }
            this.#notify_fn(false);
        });
        this.#port_native.onMessage.addListener(
            this.#on_message_native.bind(this),
        );
        ssoLog("Broker created");
    }

    isConnected() {
        return this.#port_native !== null;
    }

    isRunning() {
        return this.#online;
    }

    getAccounts() {
        this.#port_native.postMessage({ command: "getAccounts" });
        return this.#rpc_queue.register_handle("getAccounts");
    }

    async acquireTokenSilently(account) {
        this.#port_native.postMessage({
            command: "acquireTokenSilently",
            account: account.brokerObject(),
        });
        return this.#rpc_queue.register_handle("acquireTokenSilently");
    }

    async acquirePrtSsoCookie(account, ssoUrl) {
        this.#port_native.postMessage({
            command: "acquirePrtSsoCookie",
            account: account.brokerObject(),
            ssoUrl: ssoUrl,
        });
        return this.#rpc_queue.register_handle("acquirePrtSsoCookie");
    }

    async getVersion() {
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
