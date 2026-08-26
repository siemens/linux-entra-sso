/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2026 Siemens
 */

import { Deferred } from "./utils.js";
import { StateMachine } from "./state-machine.js";

/*
 * Top-level application state. Bootstrapping is the first phase covered
 * here, further states are meant to be added as substates.
 *
 *   NEW -> RESTORING -> WAITING_FOR_BROKER -> LOADING -> COMPLETE
 *                                              ^           |
 *                                              |           v
 *                                              +------- FAILED
 */
export const AppState = Object.freeze({
    NEW: "new",
    RESTORING: "restoring",
    WAITING_FOR_BROKER: "waiting-for-broker",
    LOADING: "loading",
    COMPLETE: "complete",
    FAILED: "failed",
});

/* Successor states, any transition not listed here is rejected. */
const TRANSITIONS = Object.freeze({
    [AppState.NEW]: [AppState.RESTORING],
    [AppState.RESTORING]: [AppState.WAITING_FOR_BROKER],
    [AppState.WAITING_FOR_BROKER]: [AppState.LOADING],
    [AppState.LOADING]: [AppState.COMPLETE, AppState.FAILED],
    [AppState.COMPLETE]: [],
    /* a failed bootstrap can be retried */
    [AppState.FAILED]: [AppState.LOADING],
});

export class AppStateMachine extends StateMachine {
    #broker_ready = new Deferred();

    constructor() {
        super("app-state", TRANSITIONS, AppState.NEW);
    }

    /* ---- conditions ---- */

    /* The persisted state is available, so the UI can be updated. */
    is_restored() {
        return !this.is_in(AppState.NEW, AppState.RESTORING);
    }

    may_bootstrap() {
        return this.can_enter(AppState.LOADING);
    }

    has_failed() {
        return this.is_in(AppState.FAILED);
    }

    /* ---- transitions ---- */

    /* Returns true only for the first caller, which owns the startup. */
    initialize() {
        return this.transition(AppState.RESTORING);
    }

    restored() {
        return this.transition(AppState.WAITING_FOR_BROKER);
    }

    /* Opens the gate that holds back begin_bootstrap() until the host reported a state. */
    broker_ready() {
        this.#broker_ready.resolve();
    }

    /* Resolves to true if the caller may run the bootstrap sequence. */
    async begin_bootstrap() {
        if (!this.may_bootstrap()) return false;
        await this.#broker_ready.promise;
        return this.transition(AppState.LOADING);
    }

    bootstrap_succeeded() {
        return this.transition(AppState.COMPLETE);
    }

    bootstrap_failed() {
        return this.transition(AppState.FAILED);
    }
}
