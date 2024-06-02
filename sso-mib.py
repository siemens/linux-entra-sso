#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# SPDX-FileCopyrightText: Copyright 2024 Siemens AG


import sys
import json
import struct
from pydbus import SessionBus
import uuid
from gi.repository import GLib

# the ssoUrl is a mandatory parameter when requesting a PRT SSO
# Cookie, but the correct value is not checked as of 30.05.2024
# by the authorization backend. By that, a static (fallback)
# value can be used, if no real value is provided.
SSO_URL_DEFAULT = "https://login.microsoftonline.com/"


class NativeMessaging:
    @staticmethod
    def getMessage():
        """
            Read a message from stdin and decode it.
        """
        rawLength = sys.stdin.buffer.read(4)
        if len(rawLength) == 0:
            sys.exit(0)
        messageLength = struct.unpack('@I', rawLength)[0]
        message = sys.stdin.buffer.read(messageLength).decode('utf-8')
        return json.loads(message)

    @staticmethod
    def encodeMessage(messageContent):
        """
            Encode a message for transmission, given its content
        """
        encodedContent = json.dumps(messageContent, separators=(',', ':')) \
            .encode('utf-8')
        encodedLength = struct.pack('@I', len(encodedContent))
        return {'length': encodedLength, 'content': encodedContent}

    @staticmethod
    def sendMessage(encodedMessage):
        """
            Send an encoded message to stdout
        """
        sys.stdout.buffer.write(encodedMessage['length'])
        sys.stdout.buffer.write(encodedMessage['content'])
        sys.stdout.buffer.flush()


class SsoMib:
    NO_BROKER = {'error': 'Broker not available'}
    BROKER_NAME = 'com.microsoft.identity.broker1'
    BROKER_PATH = '/com/microsoft/identity/broker1'

    def __init__(self, daemon=False):
        self._bus = SessionBus()
        self.broker_online = False
        self.session_id = uuid.uuid4()
        self._check_broker_online()
        if daemon:
            self._monitor_bus()

    def _check_broker_online(self):
        dbus = self._bus.get('org.freedesktop.DBus', '/')
        if dbus.NameHasOwner(self.BROKER_NAME):
            self._instantiate_broker()
            self.broker_online = True
        else:
            self.broker_online = False

    def _instantiate_broker(self):
        self.broker = self._bus.get(self.BROKER_NAME, self.BROKER_PATH)

    def _monitor_bus(self):
        self._bus.subscribe(
            sender="org.freedesktop.DBus",
            object="/org/freedesktop/DBus",
            signal="NameOwnerChanged",
            arg0=self.BROKER_NAME,
            signal_fired=self._broker_state_changed)

    def _broker_state_changed(self, sender, object, iface, signal, params):
        # params = (name, old_owner, new_owner)
        if params[2]:
            print(f"{self.BROKER_NAME} appeared on bus.", file=sys.stderr)
            self._instantiate_broker()
            self.broker_online = True
        else:
            print(f"{self.BROKER_NAME} disappeared on bus.", file=sys.stderr)
            self.broker_online = False

    def getAccounts(self):
        if not self.broker_online:
            return self.NO_BROKER
        context = {
            'clientId': str(self.session_id),
            'redirectUri': str(self.session_id)
        }
        resp = self.broker.getAccounts('0.0',
                                       str(self.session_id),
                                       json.dumps(context))
        return json.loads(resp)

    def acquirePrtSsoCookie(self, account, ssoUrl):
        if not self.broker_online:
            return self.NO_BROKER
        request = {
            'account': account,
            'authParameters': {
                'accessTokenToRenew': '',
                'account': account,
                'additionalQueryParametersForAuthorization': {},
                'authority': 'https://login.microsoftonline.com/common',
                'authorizationType': 8,  # OAUTH2
                'clientId': str(self.session_id),
                'decodedClaims': '',
                'enrollmentId': '',
                'password': '',
                'popParams': None,
                'redirectUri': 'https://login.microsoftonline.com'
                               '/common/oauth2/nativeclient',
                'requestedScopes': ["https://graph.microsoft.com/.default"],
                'username': account['username'],
                'uxContextHandle': -1
                },
            'ssoUrl': ssoUrl
        }
        token = json.loads(self.broker.acquirePrtSsoCookie(
            '0.0', str(self.session_id), json.dumps(request)))
        return token


def run_as_plugin():
    def respond(command, message):
        NativeMessaging.sendMessage(
            NativeMessaging.encodeMessage(
                {"command": command, "message": message}))

    print("Running as browser plugin.", file=sys.stderr)
    print("For interactive mode, start with --interactive", file=sys.stderr)
    ssomib = SsoMib(daemon=True)
    accounts = []
    loop = GLib.MainLoop()
    while True:
        receivedMessage = NativeMessaging.getMessage()
        cmd = receivedMessage['command']
        loop.get_context().iteration(False)
        if len(accounts) == 0:
            accounts_resp = ssomib.getAccounts()
            if 'error' in accounts_resp:
                respond(cmd, accounts_resp)
                continue
            accounts = accounts_resp["accounts"]
        if cmd == "acquirePrtSsoCookie":
            ssoUrl = receivedMessage['ssoUrl'] or SSO_URL_DEFAULT
            token = ssomib.acquirePrtSsoCookie(accounts[0], ssoUrl)
            respond(cmd, token)


def run_interactive():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--interactive", action="store_true",
                        help="run in interactive mode")
    parser.add_argument("-a", "--account", type=int, default=0,
                        help="account index to use for operations")
    parser.add_argument("-s", "--ssoUrl", default=SSO_URL_DEFAULT,
                        help="ssoUrl part of SSO PRT cookie request")
    parser.add_argument("command", choices=["getAccounts",
                                            "acquirePrtSsoCookie",
                                            "monitor"])
    args = parser.parse_args()

    monitor_mode = args.command == "monitor"
    ssomib = SsoMib(daemon=monitor_mode)
    if monitor_mode:
        print("Monitoring D-Bus for broker availability.")
        GLib.MainLoop().run()
        return

    accounts = ssomib.getAccounts()
    if args.command == 'getAccounts':
        json.dump(accounts, indent=2, fp=sys.stdout)
    elif args.command == "acquirePrtSsoCookie":
        account = accounts['accounts'][args.account]
        cookie = ssomib.acquirePrtSsoCookie(account, args.ssoUrl)
        json.dump(cookie, indent=2, fp=sys.stdout)
    # add newline
    print()


if __name__ == '__main__':
    if '--interactive' in sys.argv or '-i' in sys.argv:
        run_interactive()
    else:
        run_as_plugin()
