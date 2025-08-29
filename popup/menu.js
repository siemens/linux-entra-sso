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
/* size of avatar images */
const AVATAR_SIZE = 48;

function set_inflight() {
    if (inflight) return false;
    inflight = true;
    annotate_body_if("pending", true);
    return true;
}

function clear_inflight() {
    inflight = false;
    annotate_body_if("pending", false);
}

function annotate_body_if(annotation, state) {
    if (state) document.body.classList.add(annotation);
    else document.body.classList.remove(annotation);
}

function annotate_by_id_if(element_id, annotation, state) {
    element = document.getElementById(element_id);
    if (!element) return;
    if (state) element.classList.add(annotation);
    else element.classList.remove(annotation);
}

function setup_color_scheme() {
    const scheme = window?.matchMedia?.("(prefers-color-scheme:dark)")?.matches
        ? "dark"
        : "light";
    document.documentElement.classList.add(scheme);
}

setup_color_scheme();
bg_port.onMessage.addListener(async (m) => {
    if (m.event == "stateChanged") {
        clear_inflight();
        annotate_body_if("has-account", m.account !== null);
        annotate_body_if("nm-connected", m.nm_connected);

        if (m.account !== null) {
            const accountsdom = document.getElementById("accountlist");
            const entity = create_account_entity(m.account);
            accountsdom.replaceChildren();
            accountsdom.appendChild(entity);
        }

        active = m.enabled && m.account !== null;
        annotate_by_id_if("entity-guest", "active", !active);

        annotate_by_id_if("broker-state", "connected", m.broker_online);
        document.getElementById("broker-state-value").innerText =
            m.broker_online ? "connected" : "disconnected";
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

function create_account_entity(account) {
    const entity = document.createElement("div");
    entity.classList.add("entity");
    if (account.active) entity.classList.add("active");

    const avatarDiv = document.createElement("div");
    avatarDiv.classList.add("avatar");

    if (account.avatar !== null) {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        let img = new Image(AVATAR_SIZE, AVATAR_SIZE);
        img.src = account.avatar;
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
        };
        avatarDiv.appendChild(canvas);
    } else {
        const fallbackImg = document.createElement("img");
        fallbackImg.src = "profile-outline.svg";
        fallbackImg.width = AVATAR_SIZE;
        fallbackImg.height = AVATAR_SIZE;
        fallbackImg.alt = "Avatar";
        avatarDiv.appendChild(fallbackImg);
    }
    entity.appendChild(avatarDiv);

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("info");

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.innerText = account.name;
    infoDiv.appendChild(nameDiv);

    const emailDiv = document.createElement("div");
    emailDiv.className = "email";
    emailDiv.innerText = account.username;
    infoDiv.appendChild(emailDiv);

    entity.appendChild(infoDiv);
    entity.addEventListener("click", (event) => {
        if (account.active) return;
        if (!set_inflight(this)) return;
        bg_port.postMessage({ command: "enable", username: account.username });
    });
    return entity;
}

document.getElementById("entity-guest").addEventListener("click", (event) => {
    if (!active) return;
    if (!set_inflight(this)) return;
    bg_port.postMessage({ command: "disable" });
});

function check_sso_provider_perms() {
    const permissionsToCheck = {
        origins: [sso_url + "/*"],
    };
    chrome.permissions.contains(permissionsToCheck).then((result) => {
        annotate_by_id_if("message-box", "hidden", result);
    });
}

async function check_bg_sso_enabled() {
    let [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (
        !Object.hasOwn(tab, "url") ||
        !tab.url.startsWith("https://") ||
        tab.url.startsWith(sso_url)
    ) {
        annotate_by_id_if("bg-sso-state", "hidden", true);
        return;
    }
    annotate_by_id_if("bg-sso-state", "hidden", false);

    var tab_hostname = new URL(tab.url).hostname;
    current_filter = "https://" + tab_hostname + "/*";
    document.getElementById("current-url").innerText = tab_hostname;
    const permissionsToCheck = {
        origins: [current_filter],
    };
    chrome.permissions.contains(permissionsToCheck).then((result) => {
        annotate_by_id_if("bg-sso-state", "connected", result);
    });
    const state_immutable =
        gpo !== null && (gpo.has_catch_all || tab_hostname in gpo.apps_managed);
    annotate_by_id_if("bg-sso-state", "immutable", state_immutable);
}

function check_gpo_update() {
    annotate_by_id_if("gpo-update-box", "hidden", gpo === null || !gpo.pending);
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
