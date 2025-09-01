#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# SPDX-FileCopyrightText: Copyright 2025 Siemens AG
"""
Mock implementation of the native part to test the web extension
without having a broker.
"""

import importlib
import sys
import time
import jwt


les = importlib.import_module("linux-entra-sso")


class SsoMibMock(les.SsoMib):
    """
    Implementation of the SsoMib without broker communication.
    """

    # random but stable
    MOCK_TENANT = "f52f0148-c8bb-4ee1-899b-8f93b0e4d63d"

    def __init__(self, daemon=False):  # pylint: disable=unused-argument
        self.broker = True

    def on_broker_state_changed(self, callback):  # pylint: disable=unused-argument
        """
        We do not implement state changes yet.
        """

    def get_accounts(self):
        """
        Returns two fake accounts with otherwise valid data.
        """
        return {
            "accounts": [
                {
                    "name": "Account, Test (My Org Code)",
                    "givenName": "Account, Test (My Org Code)",
                    "username": "test.account@my-org.example.com",
                    "homeAccountId": f"{self.MOCK_TENANT}-a975168d-a362-458b-af1c-a8982b1e8aac",
                    "localAccountId": "a975168d-a362-458b-af1c-a8982b1e8aac",
                    "clientInfo": jwt.encode(
                        {"some": "payload"}, "secret", algorithm="HS256"
                    ).split(".", maxsplit=1)[0],
                    "realm": self.MOCK_TENANT,
                },
                {
                    "name": "Account, Admin (My Org Code)",
                    "givenName": "Account, Admin (My Org Code)",
                    "username": "test.admin@my-org.example.com",
                    "homeAccountId": f"{self.MOCK_TENANT}-2f205376-88f7-47a4-be93-8aa7cae8e4fa",
                    "localAccountId": "2f205376-88f7-47a4-be93-8aa7cae8e4fa",
                    "clientInfo": jwt.encode(
                        {"some": "payload"}, "secret", algorithm="HS256"
                    ).split(".", maxsplit=1)[0],
                    "realm": self.MOCK_TENANT,
                },
            ]
        }

    def acquire_prt_sso_cookie(
        self, account, sso_url, scopes=les.SsoMib.GRAPH_SCOPES
    ):  # pylint: disable=dangerous-default-value,unused-argument
        """
        Return a fake PRT SSO Cookie. The returned data cannot be used to perform SSO.
        """
        return {
            "account": account,
            "cookieContent": jwt.encode(
                {"scopes": " ".join(scopes)}, "secret", algorithm="HS256"
            ),
            "cookieName": "x-ms-RefreshTokenCredential",
        }

    def acquire_token_silently(
        self, account, scopes=les.SsoMib.GRAPH_SCOPES
    ):  # pylint: disable=dangerous-default-value
        """
        Return a fake (invalid) token.
        """
        return {
            "brokerTokenResponse": {
                "accessToken": jwt.encode(
                    {"scopes": " ".join(scopes)}, "secret", algorithm="HS256"
                ),
                "accessTokenType": 0,
                "idToken": jwt.encode(
                    {"scopes": " ".join(scopes)}, "secret", algorithm="HS256"
                ),
                "account": account,
                "clientInfo": account["clientInfo"],
                "expiresOn": int(time.time() + 3600) * 1000,
                "extendedExpiresOn": int(time.time() + 2 * 3600) * 1000,
                "grantedScopes": scopes + ["profile"],
            }
        }

    def get_broker_version(self):
        """
        Return the broker and script version (marked as mock).
        """
        return {
            "linuxBrokerVersion": "2.0.1-mock",
            "native": f"{les.LINUX_ENTRA_SSO_VERSION}-mock",
        }


les.SsoMib = SsoMibMock

if __name__ == "__main__":
    if "--interactive" in sys.argv or "-i" in sys.argv:
        les.run_interactive()
    else:
        les.run_as_native_messaging()
