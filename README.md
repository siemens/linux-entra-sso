<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Entra ID SSO via Microsoft Identity Broker on Linux

This browser extension uses a locally running Microsoft Identity Broker to authenticate the current user on Microsoft Entra ID on Linux devices.
By that, also sites behind conditional access policies can be accessed.
The extension is written for Firefox but provides a limited support for Google Chrome, Chromium and Thunderbird.

> [!NOTE]
> This extension will only work on intune-enabled Linux devices. Please double
> check this by running the `intune-portal` application and check if your user
> is logged in (after clicking `sign-in`).

## Installation

The extension consists of two parts:

- a host program that communicates with the Microsoft Identity Broker via DBus
- a WebExtension that injects the acquired tokens into the corresponding requests

### Dependencies

The extension requires [PyGObject](https://pygobject.gnome.org/) and [pydbus](https://github.com/LEW21/pydbus) as runtime dependencies.

- On Debian: `sudo apt-get install python3-gi python3-pydbus`
- On Arch Linux: `sudo pacman -S python-gobject python-pydbus`
- If you are using a Python version manager such as `asdf` you must install the Python packages manually: `pip install PyGObject pydbus`

### Installation of Host Tooling

1. Clone this repository:

```bash
$ git clone https://github.com/siemens/linux-entra-sso.git
$ cd linux-entra-sso
```

2. Run the local install command (for the intended target):

```bash
$ # Firefox & Thunderbird
$ make local-install-firefox
$ # Chromium, Chrome and Brave
$ make local-install-(brave|chrome|chromium|vivaldi)
$ # All supported browsers
$ make local-install
```

> [!NOTE]
> System-wide installation and configuration is supported. For more information, see [Global Install](docs/global_install.md).

### Installation of WebExtension

To complete the setup, install the WebExtension in your browser. This is necessary alongside the host tooling for the extension to function properly.

**Firefox & Thunderbird: Signed Version from GitHub Releases**:
Install the signed webextension `linux_entra_sso-<version>.xpi` from the [project's releases page](https://github.com/siemens/linux-entra-sso/releases).
If you are installing for Thunderbird, right-click the link and select "Save Link As..." to avoid installing it in Firefox.

**Chromium, Chrome & Brave: Signed Extension from Chrome Web Store**:
Install the signed browser extension from the [Chrome Web Store](https://chrome.google.com/webstore/detail/jlnfnnolkbjieggibinobhkjdfbpcohn).

**Development Version and Other Browsers**:
If you want to execute unsigned versions of the extension (e.g. test builds) on Firefox, you have to use either Firefox ESR,
nightly or developer, as [standard Firefox does not allow installing unsigned extensions](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#w_what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users)
since version 48.

To build the extension, perform the following steps:

1. run `make` to build the extension (For Firefox, `build/<platform>/linux-entra-sso-*.xpi` is generated)
2. Firefox only: Permit unsigned extensions in Firefox by setting `xpinstall.signatures.required` to `false`
3. Chrome only: In extension menu, enable `Developer mode`.
4. Install the extension in the Browser from the local `linux-entra-sso-*.xpi` file (Firefox). On Chrome, use `load unpacked` and point to `build/chrome`

## Usage

After installing the extension, you might need to manually grant the following permission:

- Access your data for `https://login.microsoftonline.com`.

**No configuration is required.** The SSO is automatically enabled.
If you want to disable the SSO for this session, click on the tray icon and select the guest account.
In case you are already logged in, you might need to clear all cookies on `login.microsoftonline.com`.

### Single Page Applications

For single-page applications (SPAs, like the Teams PWA) that perform automated re-logins in the background,
ensure the extension has the necessary permissions to interact with the SPA's domain.
Otherwise, a manual re-login after approximately 24 hours (depending on the tenant's configuration) may be required.

To grant the necessary permissions, follow these steps:

1. Open the SPA URL in your web browser
2. Click on the extension's tray icon
3. Click on "Background SSO (enable)"
4. A dot should appear next to the domain indicating that permission has been granted

Once configured, no further authentication requests will be needed.
To revoke permissions, return to the extension's settings and select the domain again.
For details, also see [PRIVACY.md](PRIVACY.md).

### Technical Background

When enabled, the extension acquires a [PRT SSO Cookie](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oapxbc/105e4d17-defd-4637-a520-173db2393a4b)
from the locally running `microsoft-identity-broker` service and inject that into the OAuth2 login flow on Microsoft Entra ID (`login.microsoftonline.com`).

## Known Limitations

### Snap version of Firefox on Ubuntu

Running the extension in a Snap Firefox on Ubuntu 22.04 or later is supported but requires the `xdg-desktop-portal` host package and at least Firefox 104.
After installing the extension (both native and web extension part), restart the browser.
When Firefox starts, a message should appear to allow Firefox to use the `WebExtension` backend.
Once granted, the application should behave as on a native install.

An alternative is to use the `firefox-esr` Debian package.

### Expired Tokens on Chrome

Due to not having the `WebRequestsBlocking` API on Chrome, the extension needs to use a different mechanism to inject the token.
While in Firefox the token is requested on-demand when hitting the SSO login URL, in Chrome the token is requested periodically.
Then, a `declarativeNetRequest` API rule is setup to inject the token. As the lifetime of the tokens is limited and cannot be checked,
outdated tokens might be injected. Further, a generic SSO URL must be used when requesting the token, instead of the actual one.

## Troubleshooting

In case the extension is not working, check the following:

- run host component in interactive mode: `python3 ./linux-entra-sso.py --interactive acquirePrtSsoCookie`
- check if SSO is working in the Edge browser

# Code Integrity

Since version `v0.4`, git release tags are signed with one of the following maintainer GPG keys:

- `AF73F6EF5A53CFE304569F50E648A311F67A50FC` (Felix Moessbauer)
- `004C647D7572CF7D72BDB4FB699D850A9F417BD8` (Jan Kiszka)

Since version `v1.8.0`, the following keys are used:

- `3785ED68D0F83B7BD7D23D7FE1136CEB2754A0BD` (Felix Moessbauer)
- `004C647D7572CF7D72BDB4FB699D850A9F417BD8` (Jan Kiszka)

## License

This project is licensed according to the terms of the Mozilla Public
License, v. 2.0. A copy of the license is provided in `LICENSES/MPL-2.0.txt`.
