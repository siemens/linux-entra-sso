<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Single Sign On via Microsoft Identity Broker

This browser plugin uses a locally running microsoft identity broker
to authenticate the current user on Azure Entra ID. By that, also sites
behind conditional access policies can be accessed.

## Pre-conditions

This extension will only work on intune-enabled Linux devices. Please double
check this by running the `intune-portal` application and check if your user
is logged in (after clicking `sign-in`).
Also, make sure to use either Firefox ESR, nightly or developer, as [standard Firefox does not allow installing unsigned plugins](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#w_what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users) since version 48.

## Installation

The extension is not yet signed by Mozilla and hence can only be added
as temporary extension. For that, perform the following steps:

1. clone this repository
2. run `make` to build the extension `sso-mib-*.xpi`
3. run `make local-install` to install the native messaging app in the user's `.mozilla` folder
4. Permit unsigned extensions is Firefox by setting `xpinstall.signatures.required` to `false`
5. Install the extension in Firefox from the local `sso-mib-*.xpi` file
6. Enable "Access your data for https://login.microsoftonline.com" under the extension's permissions

## Usage

No configuration is required. However, you might need to clear all cookies on
`login.microsoftonline.com`, in case you are already logged. The extension
will automatically acquire a [PRT SSO Cookie](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oapxbc/105e4d17-defd-4637-a520-173db2393a4b)
from the locally running device identity broker and inject that into the OAuth2 login workflow for all entra-id enabled sites
(the ones you log in via `login.microsoftonline.com`).

## Known Limitations

### SNAP version not supported

This extension will not work on the snap version of Firefox.
The extension executes a script `sso-mib.py` on the host that communicates via DBus with the `microsoft-identity-broker` service.
As the SNAP executes Firefox inside a container, the communication with DBus will not work. Please use the `firefox-esr` Debian package instead.

## License

This project is licensed according to the terms of the Mozilla Public
License, v. 2.0. A copy of the license is provided in `LICENSES/MPL-2.0.txt`.

## Maintainers

- Felix Moessbauer <felix.moessbauer@siemens.com>
