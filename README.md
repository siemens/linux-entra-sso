<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Entra ID SSO via Microsoft Identity Broker on Linux

This browser extension uses a locally running Microsoft Identity Broker to authenticate the current user on Microsoft Entra ID on Linux devices.
By that, also sites behind conditional access policies can be accessed.
The extension is written for Firefox but provides a limited support for Google Chrome, Chromium and Thunderbird.

## Pre-conditions

This extension will only work on intune-enabled Linux devices. Please double
check this by running the `intune-portal` application and check if your user
is logged in (after clicking `sign-in`).
Also make sure to install the host components (see *Installation* below).

## Installation

The extension requires [PyGObject](https://pygobject.gnome.org/) and [pydbus](https://github.com/LEW21/pydbus) as runtime dependencies.

- On Debian: `sudo apt-get install python3-gi python3-pydbus`
- On Arch Linux: `sudo pacman -S python-gobject python-pydbus`
- If you are using a Python version manager such as `asdf` you must install the Python packages manually: `pip install PyGObject pydbus`

**Note:** System-wide installation and configuration is supported. For more information, see [Global Install](docs/global_install.md).

### Firefox & Thunderbird: Signed Version from GitHub Releases

You can download a **signed version** of the browser extension directly from our [GitHub Releases](https://github.com/siemens/linux-entra-sso/releases).

> This package includes only the **browser extension**. The **host tooling** must still be installed manually.

#### Installation Steps

1. Clone this repository:

```bash
$ git clone https://github.com/siemens/linux-entra-sso.git
$ cd linux-entra-sso
```

2. Run the local install command:

```bash
$ make local-install-firefox
```

3. Download the extension file:

Get the `linux_entra_sso-<version>.xpi` file from the [project's releases page](https://github.com/siemens/linux-entra-sso/releases).

> If you are installing for Thunderbird, right-click the link and select "Save Link As..." to avoid installing it in Firefox.

4. Enable required permissions:

After installing the extension, enable the following permission:

Access your data for `https://login.microsoftonline.com`.
To support transparent re-login on applications using this identity provider, you need to grant permission for these domains as well.
For details, see [PRIVACY.md](PRIVACY.md).

### Chrome & Brave: Signed Extension from Chrome Web Store

You can install the signed browser extension from the [Chrome Web Store](https://chrome.google.com/webstore/detail/jlnfnnolkbjieggibinobhkjdfbpcohn), which works for both **Google Chrome** and **Brave Browser**.

> **Note:** This only installs the browser extension. You still need to install the host integration manually.

#### Installation Steps:

1. Clone this repository:

```bash
$ git@github.com:siemens/linux-entra-sso.git
$ cd linux-entra-sso
```

2. Run the local install command:

```bash
$ make local-install-chrome # command for Chrome Browser
$ make local-install-brave # command for Brave Browser
```

3. Install the extension file:

-  [linux-entra-sso](https://chromewebstore.google.com/detail/linux-entra-sso/jlnfnnolkbjieggibinobhkjdfbpcohn)

### Development Version and Other Browsers

If you want to execute unsigned versions of the extension (e.g. test builds) on Firefox, you have to use either Firefox ESR,
nightly or developer, as [standard Firefox does not allow installing unsigned extensions](https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox#w_what-are-my-options-if-i-want-to-use-an-unsigned-add-on-advanced-users)
since version 48.

To build the extension and install the host parts, perform the following steps:

1. clone this repository
2. run `make local-install-<firefox|chrome|brave>` to install the native messaging app in the user's `.mozilla` (or Chrome) folder
3. run `make` to build the extension (For Firefox, `build/<platform>/linux-entra-sso-*.xpi` is generated)
4. Firefox only: Permit unsigned extensions in Firefox by setting `xpinstall.signatures.required` to `false`
4. Chrome only: In extension menu, enable `Developer mode`.
5. Install the extension in the Browser from the local `linux-entra-sso-*.xpi` file (Firefox). On Chrome, use `load unpacked` and point to `build/chrome`
6. Enable "Access your data for `https://login.microsoftonline.com`" under the extension's permissions

### Global Installation of Host Components

Linux distributions can ship the host components by packaging the output of `make install` (`DESTDIR` is supported).
This makes the host parts available to all users, but will only work with the signed versions of the extension.
On Chrome, the extension is registered to be auto-installed when starting the browser.
On Firefox and Chromium, the users still need to manually install the browser extension from the respective stores.

**Note:** The native messaging dirs vary across Linux distributions.
The variables `(firefox|chrome|chromium)_nm_dir` and `chrome_ext_dir` need to be set accordingly.
The Python interpreter (shebang) is resolved at install time to avoid depending on venvs at runtime.
This can be changed by setting `python3_bin`.
The provided defaults work on a Debian system.
For details, have a look at the Makefile.

## Usage

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

## License

This project is licensed according to the terms of the Mozilla Public
License, v. 2.0. A copy of the license is provided in `LICENSES/MPL-2.0.txt`.
