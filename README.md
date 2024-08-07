<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Entra ID SSO via Microsoft Identity Broker on Linux

This browser extension uses a locally running Microsoft Identity Broker to authenticate the current user on Microsoft Entra ID on Linux devices.
By that, also sites behind conditional access policies can be accessed.
The extension is written for Firefox but provides a limited support for Google Chrome (and Chromium).

## Pre-conditions

This extension will only work on intune-enabled Linux devices. Please double
check this by running the `intune-portal` application and check if your user
is logged in (after clicking `sign-in`).
Also make sure to install the host components (see *Installation* below).

## Dependencies

The extension requires pydbus as a runtime dependency. On a Debian system please install `python3-pydbus`:

```bash
sudo apt install python3-pydbus
```

**Note:** If you are using a python version manager such as asdf you must install the python packages manually: `pip install PyGObject pydbus`

## Installation

### Firefox: Signed Version from Github Releases

You can get a signed version of the browser extension from our Github releases.
As this only covers the browser part, the host tooling still needs to be installed manually:

1. clone this repository
2. run `make local-install-firefox`
3. Get the `linux_entra_sso-<version>.xpi` file from the [project's releases page](https://github.com/siemens/linux-entra-sso/releases)
4. Enable "Access your data for https://login.microsoftonline.com" under the extension's permissions

### Chrome: Signed Version from Chrome Web Store

You can get a signed version of the browser extension from the Chrome Web Store.
As this only covers the browser part, the host tooling still needs to be installed manually:

1. clone this repository
2. run `make local-install-chrome`
3. Install the [linux-entra-sso](https://chrome.google.com/webstore/detail/jlnfnnolkbjieggibinobhkjdfbpcohn) Chrome extension from the Chrome Web Store

### Development Version and Other Browsers

If you want to execute unsigned versions of the extension (e.g. test builds) on Firefox, you have to use either Firefox ESR,
nightly or developer, as [standard Firefox does not allow installing unsigned extensions](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#w_what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users)
since version 48.

To build the extension and install the host parts, perform the following steps:

1. clone this repository
2. run `make local-install-<firefox|chrome>` to install the native messaging app in the user's `.mozilla` (or Chrome) folder
3. run `make` to build the extension (For Firefox, `build/<platform>/linux-entra-sso-*.xpi` is generated)
4. Firefox only: Permit unsigned extensions in Firefox by setting `xpinstall.signatures.required` to `false`
4. Chrome only: In extension menu, enable `Developer mode`.
5. Install the extension in the Browser from the local `linux-entra-sso-*.xpi` file (Firefox). On Chrome, use `load unpacked` and point to `build/chrome`
6. Enable "Access your data for https://login.microsoftonline.com" under the extension's permissions

### Global Installation of Host Components

Linux distributions can ship the host components by packaging the output of `make install` (`DESTDIR` is supported).
This makes the host parts available to all users, but will only work with the signed versions of the extension.
On Chrome, the extension is registered to be auto-installed when starting the browser.
On Firefox and Chromium, the users still need to manually install the browser extension from the respective stores.

**Note:** The native messaging dirs vary across Linux distributions.
The variables `(firefox|chrome|chromium)_nm_dir` and `chrome_ext_dir` need to be set accordingly.
The provided defaults work on a Debian system. For details, have a look at the Makefile.

## Usage

No configuration is required. The SSO is automatically enabled.
If you want to disable the SSO for this session, click on the tray icon and select the guest account.

However, you might need to clear all cookies on
`login.microsoftonline.com`, in case you are already logged. The extension
will automatically acquire a [PRT SSO Cookie](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oapxbc/105e4d17-defd-4637-a520-173db2393a4b)
from the locally running device identity broker and inject that into the OAuth2 login workflow for all Microsoft Entra ID enabled sites
(the ones you log in via `login.microsoftonline.com`).

## Known Limitations

### SNAP version not supported

This extension will not work on the snap version of Firefox.
The extension executes a script `linux-entra-sso.py` on the host that communicates via DBus with the `microsoft-identity-broker` service.
As the SNAP executes Firefox inside a container, the communication with DBus will not work. Please use the `firefox-esr` Debian package instead.

### Expired Tokens on Chrome

Due to not having the WebRequestsBlocking API on Chrome, the extension needs to use a different mechanism to inject the token.
While in Firefox the token is requested on-demand when hitting the SSO login URL, in Chrome the token is requested periodically.
Then, a declarativeNetRequest API rule is setup to inject the token. As the lifetime of the tokens is limited and cannot be checked,
outdated tokens might be injected. Further, a generic SSO URL must be used when requesting the token, instead of the actual one.

## Troubleshooting

In case the extension is not working, check the following:

- run host component in interactive mode: `python3 ./linux-entra-sso.py --interactive acquirePrtSsoCookie`
- check if SSO is working in the Edge browser

## License

This project is licensed according to the terms of the Mozilla Public
License, v. 2.0. A copy of the license is provided in `LICENSES/MPL-2.0.txt`.
