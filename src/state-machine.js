/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 */

import { ssoLog } from "./utils.js";

/*
 * States are plain strings, the allowed transitions are declared as a
 * map of state -> successor states. Transitions outside that map are
 * rejected, so the model is the single source of truth.
 */
export class StateMachine {
    #name;
    #state;
    #transitions;

    constructor(name, transitions, initial) {
        this.#name = name;
        this.#transitions = transitions;
        this.#state = initial;
    }

    get state() {
        return this.#state;
    }

    is_in(...states) {
        return states.includes(this.#state);
    }

    can_enter(next) {
        return this.#transitions[this.#state].includes(next);
    }

    /* Returns false if the transition is not allowed by the model. */
    transition(next) {
        if (!this.can_enter(next)) return false;
        ssoLog(`${this.#name}: ${this.#state} -> ${next}`);
        this.#state = next;
        return true;
    }
}
