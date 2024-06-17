<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Single Sign On via Microsoft Identity Broker

This browser plugin uses a locally running microsoft identity broker
to authenticate the current user on Microsoft Entra ID. By that, also sites
behind conditional access policies can be accessed. The plugin is written
for Firefox but provides a limited support for Google Chrome (and Chromium) as well.

## Pre-conditions

This extension will only work on intune-enabled Linux devices. Please double
check this by running the `intune-portal` application and check if your user
is logged in (after clicking `sign-in`).
Also, make sure to use either Firefox ESR, nightly or developer, as [standard Firefox does not allow installing unsigned plugins](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#w_what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users) since version 48.

## Dependencies

The extension requires pydbus as a runtime dependency. On a Debian system please install `python3-pydbus`:

```bash
sudo apt install python3-pydbus
```

**Note:** If you are using a python version manager such as asdf you must install the python packages manually: `pip install PyGObject pydbus`

## Installation

The extension is not yet signed by Mozilla and hence can only be added
as temporary extension. For that, perform the following steps:

1. clone this repository
2. run `make` to build the extension (For Firefox, `build/<platform>/sso-mib-*.xpi` is generated)
3. run `make local-install-<firefox|chrome>` to install the native messaging app in the user's `.mozilla` (or Chrome) folder
4. Permit unsigned extensions is Firefox by setting `xpinstall.signatures.required` to `false` (Firefox only)
5. Install the extension in the Browser from the local `sso-mib-*.xpi` file (Firefox). On Chrome, use `load unpacked` and point to `build/chrome`
6. Enable "Access your data for https://login.microsoftonline.com" under the extension's permissions

## Usage

No configuration is required. However, you might need to clear all cookies on
`login.microsoftonline.com`, in case you are already logged. The extension
will automatically acquire a [PRT SSO Cookie](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oapxbc/105e4d17-defd-4637-a520-173db2393a4b)
from the locally running device identity broker and inject that into the OAuth2 login workflow for all Microsoft Entra ID enabled sites
(the ones you log in via `login.microsoftonline.com`).

## Known Limitations

### SNAP version not supported

This extension will not work on the snap version of Firefox.
The extension executes a script `sso-mib.py` on the host that communicates via DBus with the `microsoft-identity-broker` service.
As the SNAP executes Firefox inside a container, the communication with DBus will not work. Please use the `firefox-esr` Debian package instead.

### Expired Tokens on Chrome

Due to not having the WebRequestsBlocking API on Chrome, the plugin needs to use a different mechanism to inject the token.
While in Firefox the token is requested on-demand when hitting the SSO login URL, in Chrome the token is requested periodically.
Then, a declarativeNetRequest API rule is setup to inject the token. As the lifetime of the tokens is limited and cannot be checked,
outdated tokens might be injected. Further, a generic SSO URL must be used when requesting the token, instead of the actual one.

## License

This project is licensed according to the terms of the Mozilla Public
License, v. 2.0. A copy of the license is provided in `LICENSES/MPL-2.0.txt`.

## Maintainers

- Felix Moessbauer <felix.moessbauer@siemens.com>
