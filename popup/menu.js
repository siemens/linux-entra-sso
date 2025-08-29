/*
 * SPDX-License-Identifier: MPL-2.0
 * SPDX-FileCopyrightText: Copyright 2024 Siemens AG
 */

let bg_port = chrome.runtime.connect({ name: "linux-entra-sso" });
/* communication with backend is in progress */
let inflight = false;
/* user is logged in */
let active = false;
/* sso provider url */
let sso_url = null;
/* current URL filter */
let current_filter = null;
/* group policy update */
let gpo = null;

function set_inflight() {
    if (inflight) return false;
    inflight = true;
    document.body.classList.add("pending");
    return true;
}

function clear_inflight() {
    inflight = false;
    document.body.classList.remove("pending");
}

function annotate_body_if(annotation, state) {
    if (state) document.body.classList.add(annotation);
    else document.body.classList.remove(annotation);
}

bg_port.onMessage.addListener(async (m) => {
    if (m.event == "stateChanged") {
        clear_inflight();
        annotate_body_if("has-account", m.account !== null);
        annotate_body_if("nm-connected", m.nm_connected);

        if (m.account !== null) {
            document.getElementById("me-name").innerText = m.account.name;
            document.getElementById("me-email").innerText = m.account.username;
            const canvas = document.getElementById("me-avatar");
            const fallback = document.getElementById("me-avatar-fallback");
            const ctx = canvas.getContext("2d");
            if (m.account.avatar !== null) {
                let img = new Image();
                await new Promise(
                    (r) => (img.onload = r),
                    (img.src = m.account.avatar),
                );
                ctx.drawImage(img, 0, 0);
                canvas.classList.remove("hidden");
                fallback.classList.add("hidden");
            } else {
                canvas.classList.add("hidden");
                fallback.classList.remove("hidden");
            }
        }
        if (m.enabled && m.account !== null) {
            document.getElementById("entity-me").classList.add("active");
            document.getElementById("entity-guest").classList.remove("active");
            active = true;
        } else {
            document.getElementById("entity-me").classList.remove("active");
            document.getElementById("entity-guest").classList.add("active");
            active = false;
        }
        let broker_state_classes =
            document.getElementById("broker-state").classList;
        let broker_state_value = document.getElementById("broker-state-value");
        if (m.broker_online) {
            broker_state_classes.add("connected");
            broker_state_classes.remove("disconnected");
            broker_state_value.innerText = "connected";
        } else {
            broker_state_classes.remove("connected");
            broker_state_classes.add("disconnected");
            broker_state_value.innerText = "disconnected";
        }
        document.getElementById("broker-version").innerText = m.broker_version;

        if (m.host_version) {
            let pvers = chrome.runtime.getManifest().version;
            let vstr = "v" + pvers;
            if (m.host_version !== pvers) {
                vstr += " (host v" + m.host_version + ")";
            }
            document.getElementById("version").innerText = vstr;
        }
        sso_url = m.sso_url;
        gpo = m.gpo_update;
        check_sso_provider_perms();
        check_bg_sso_enabled();
        check_gpo_update();
    }
});

document.getElementById("entity-me").addEventListener("click", (event) => {
    if (active) return;
    if (!set_inflight(this)) return;
    bg_port.postMessage({ command: "enable" });
});
document.getElementById("entity-guest").addEventListener("click", (event) => {
    if (!active) return;
    if (!set_inflight(this)) return;
    bg_port.postMessage({ command: "disable" });
});

function check_sso_provider_perms() {
    msgbox = document.getElementById("message-box");
    msgtext = document.getElementById("message-text");
    grant_access_text = document.getElementById("grant-access-sso");
    const permissionsToCheck = {
        origins: [sso_url + "/*"],
    };
    chrome.permissions.contains(permissionsToCheck).then((result) => {
        if (result) {
            msgbox.classList.add("hidden");
            msgbox.innerText = "";
        } else {
            msgtext.innerText = "No permission to access login provider.";
            msgbox.classList.remove("hidden");
        }
    });
}

async function check_bg_sso_enabled() {
    bg_sso_classes = document.getElementById("bg-sso-state").classList;
    let [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (!Object.hasOwn(tab, "url") || !tab.url.startsWith("https://")) {
        bg_sso_classes.add("hidden");
        return;
    }
    bg_sso_classes.remove("hidden");
    var tab_hostname = new URL(tab.url).hostname;
    current_filter = "https://" + tab_hostname + "/*";
    document.getElementById("current-url").innerText = tab_hostname;
    const permissionsToCheck = {
        origins: [current_filter],
    };
    var sso_state_classes = document.getElementById("bg-sso-state").classList;
    chrome.permissions.contains(permissionsToCheck).then((result) => {
        if (result) {
            sso_state_classes.replace("disconnected", "connected");
        } else {
            sso_state_classes.replace("connected", "disconnected");
        }
    });
    if (
        gpo !== null &&
        (gpo.has_catch_all || tab_hostname in gpo.apps_managed)
    ) {
        sso_state_classes.add("immutable");
    } else {
        sso_state_classes.remove("immutable");
    }
}

function check_gpo_update() {
    gpo_box_classes = document.getElementById("gpo-update-box").classList;
    if (gpo === null || !gpo.pending) {
        gpo_box_classes.add("hidden");
        return;
    }
    gpo_box_classes.remove("hidden");
}

function apply_gpo_update() {
    if (gpo === null) return;
    request_host_permission(gpo.filters_to_add);
    remove_host_permission(gpo.filters_to_remove);
}

function request_host_permission(urls) {
    if (urls === null || urls.length == 0) return;
    const permissionsToRequest = {
        origins: urls,
    };
    chrome.permissions.request(permissionsToRequest).then((granted) => {
        if (granted) {
            console.log("Permission granted");
            // No need to update the UI as this will trigger the permission
            // changed event in the background script, which triggers an
            // UI update.
        } else {
            console.log("Failed to get permission");
        }
    });
    // The permission-request window might open below the webextensions panel.
    // This has been observed on Thunderbird 128. Close the panel, so the user
    // can grant the permission.
    window.close();
}

function remove_host_permission(urls) {
    if (urls === null || urls.length == 0) return;
    const permissionsToRemove = {
        origins: urls,
    };
    chrome.permissions.remove(permissionsToRemove).then((removed) => {
        if (removed) console.log("Permission removed");
        else console.log("Failed to remove permission");
    });
}

// Requires user interaction, as otherwise we lack the permission to
// request further host permissions
document.getElementById("grant-access").addEventListener("click", (event) => {
    request_host_permission([current_filter]);
});

document
    .getElementById("withdraw-access")
    .addEventListener("click", (event) => {
        remove_host_permission([current_filter]);
    });

document
    .getElementById("grant-access-sso")
    .addEventListener("click", (event) => {
        request_host_permission([sso_url + "/*"]);
    });

document
    .getElementById("apply-gpo-update")
    .addEventListener("click", (event) => {
        apply_gpo_update();
    });
