# Single Sign On via Microsoft Identity Broker

This browser plugin uses a locally running microsoft identity broker
to authenticate the current user on Azure Entra ID. By that, also sites
behind conditional access policies can be accessed.

## Pre-conditions

This extension will only work on intune-enabled Linux devices. Please double
check this by running the `intune-portal` application and check if your user
is logged in (after clicking `sign-in`).

## Installation

The extension is not yet signed by Mozilla and hence can only be added
as temporary extension. For that, perform the following steps:

1. clone this repository
2. copy the `sso-mib.py` file to `/usr/local/lib/mozilla/sso-mib.py`
3. copy the `sso_mib.json` file to `~/.mozilla/native-messaging-hosts/`
4. Enable the extension in Firefox: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Your_first_WebExtension#installing

## Usage

No configuration is required. However, you might need to clear all cookies on
`login.microsoftonline.com`, in case you are already logged. The extension
will automatically acquire a [PRT SSO Cookie](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oapxbc/105e4d17-defd-4637-a520-173db2393a4b)
from the locally running device identity broker and inject that into the OAuth2 login workflow for all entra-id enabled sites
(the ones you log in via `login.microsoftonline.com`).

## Maintainers

- Felix Moessbauer <felix.moessbauer@siemens.com>
