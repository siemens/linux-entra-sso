<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Privacy Policy

The `linux-entra-sso` browser extension does not collect any data of any kind.

- `linux-entra-sso` has no home server
- `linux-entra-sso` doesn't embed any analytic or telemetry hooks in its code

To fulfill its purpose, the extension interfaces with the following services:

- Microsoft Graph API (web service)
- Microsoft Entra ID (web service)
- `com.microsoft.identity.broker1` (`broker`, DBus service)

## Microsoft Graph API

To show data about the currently logged in user (e.g. the profile picture in
the app icon), we request an access token for the `graph.microsoft.com` API.
The token is acquired from the locally running broker.

## Microsoft Identity Broker DBus service (broker)

To implement the SSO functionality, a `PRT SSO Cookie` is requested from the
locally running `com.microsoft.identity.broker1` DBus service. In the Firefox
version, whenever an URL starting with `https://login.microsoftonline.com/`
(Entra ID login URL) is accessed, a token is requested with the full request
URL. On Chrome and Chromium, the `PRT SSO Cookie` is requested periodically
with a generic URL. The returned token is injected into all http requests
hitting the Entra ID login URL.

The privacy statement for all Microsoft provided services is found on
<https://privacy.microsoft.com/en-us/PrivacyStatement>.
