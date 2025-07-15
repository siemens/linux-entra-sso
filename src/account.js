/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2025 Siemens
 */

export class Account {
    #broker_obj = null;
    avatar = null;
    avatar_imgdata = null;

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
}
