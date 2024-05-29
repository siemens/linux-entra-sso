#!/usr/bin/env python3

import sys
import json
import struct
from pydbus import SessionBus
import uuid


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
    def __init__(self):
        self.broker = SessionBus().get(
            "com.microsoft.identity.broker1",
            "/com/microsoft/identity/broker1")
        self.session_id = uuid.uuid4()

    def getAccounts(self):
        context = {
            'clientId': str(self.session_id),
            'redirectUri': str(self.session_id)
        }
        resp = self.broker.getAccounts('0.0',
                                       str(self.session_id),
                                       json.dumps(context))
        return json.loads(resp)['accounts']

    def acquirePrtSsoCookie(self, account):
        tenant = account['realm']
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
            'ssoUrl': 'https://login.microsoftonline.com'
                      f'/{tenant}/oauth2/v2.0/authorize'
        }
        token = json.loads(self.broker.acquirePrtSsoCookie(
            '0.0', str(self.session_id), json.dumps(request)))
        return token


def run_as_plugin(ssomib: SsoMib):
    print("Running as browser plugin.", file=sys.stderr)
    print("For interactive mode, start with --interactive", file=sys.stderr)
    accounts = ssomib.getAccounts()
    while True:
        receivedMessage = NativeMessaging.getMessage()
        if receivedMessage == "acquirePrtSsoCookie":
            NativeMessaging.sendMessage(
                NativeMessaging.encodeMessage(
                    ssomib.acquirePrtSsoCookie(accounts[0])))


def run_interactive(ssomib: SsoMib):
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--interactive", action="store_true",
                        help="run in interactive mode")
    parser.add_argument("-a", "--account", type=int, default=0,
                        help="account index to use for operations")
    parser.add_argument("command", choices=["getAccounts",
                                            "acquirePrtSsoCookie"])
    args = parser.parse_args()

    accounts = ssomib.getAccounts()
    if args.command == 'getAccounts':
        json.dump(accounts, indent=2, fp=sys.stdout)
    elif args.command == "acquirePrtSsoCookie":
        account = accounts[args.account]
        cookie = ssomib.acquirePrtSsoCookie(account)
        json.dump(cookie, indent=2, fp=sys.stdout)
    # add newline
    print()


if __name__ == '__main__':
    ssomib = SsoMib()
    if '--interactive' in sys.argv or '-i' in sys.argv:
        run_interactive(ssomib)
    else:
        run_as_plugin(ssomib)
