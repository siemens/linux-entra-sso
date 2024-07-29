/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

let bg_port = chrome.runtime.connect({ name: "linux-entra-sso" });
/* communication with backend is in progress */
let inflight = false;
/* user is logged in */
let active = false;

function set_inflight() {
    if (inflight)
        return false;
    inflight = true;
    document.body.classList.add("pending");
    return true;
}

function clear_inflight() {
    inflight = false;
    document.body.classList.remove("pending");
}

bg_port.onMessage.addListener(async (m) => {
    if (m.event == "stateChanged") {
        clear_inflight();
        if (m.account !== null) {
            document.getElementById("me-name").innerHTML = m.account.name;
            document.getElementById("me-email").innerHTML = m.account.username
            const canvas = document.getElementById("me-avatar");
            const fallback = document.getElementById("me-avatar-fallback");
            const ctx = canvas.getContext('2d');
            if (m.account.avatar !== null) {
                let img = new Image();
                await new Promise(r => img.onload=r, img.src=m.account.avatar);
                ctx.drawImage(img, 0, 0);
                canvas.classList.remove("hidden");
                fallback.classList.add("hidden");
            } else {
                canvas.classList.add("hidden");
                fallback.classList.remove("hidden");
            }
        }
        if (m.enabled && m.broker_online) {
            document.getElementById("entity-me").classList.add("active");
            document.getElementById("entity-guest").classList.remove("active");
            active = true;
        } else {
            document.getElementById("entity-me").classList.remove("active");
            document.getElementById("entity-guest").classList.add("active");
            active = false;
        }
    }
});

document.getElementById("entity-me").addEventListener("click", (event) => {
    if (active) return;
    if (!set_inflight(this)) return;
    bg_port.postMessage({ command: "login"});
});
document.getElementById("entity-guest").addEventListener("click", (event) => {
    if (!active) return;
    if (!set_inflight(this)) return;
    bg_port.postMessage({ command: "logout"});
});
document.getElementById("version").innerHTML = "v" + chrome.runtime.getManifest().version;
