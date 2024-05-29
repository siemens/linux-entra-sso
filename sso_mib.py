#!/usr/bin/env python3

import sys
import json
import struct
from pydbus import SessionBus
import uuid


def acquirePrtSsoCookie(broker):
    """
    Acquire a Prt SSO cookie from the broker.
    """
    context = {
        'clientId': str(session_id),
        'redirectUri': str(session_id)
    }
    resp = json.loads(broker.getAccounts('0.0',
                                         str(session_id),
                                         json.dumps(context)))

    account = resp['accounts'][0]
    tenant = account['realm']
    request = {
        'account': account,
        'authParameters': {
            'accessTokenToRenew': '',
            'account': account,
            'additionalQueryParametersForAuthorization': {},
            'authority': 'https://login.microsoftonline.com/common',
            'authorizationType': 8,  # OAUTH2
            'clientId': str(session_id),
            'decodedClaims': '',
            'enrollmentId': '',
            'password': '',
            'popParams': None,
            'redirectUri': 'https://login.microsoftonline.com/common/oauth2/nativeclient',
            'requestedScopes': ["https://graph.microsoft.com/.default"],
            'username': account['username'],
            'uxContextHandle': -1
            },
        'ssoUrl': f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize'
    }
    token = json.loads(broker.acquirePrtSsoCookie('0.0', str(session_id), json.dumps(request)))
    return token


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


def encodeMessage(messageContent):
    """
        Encode a message for transmission, given its content
    """
    encodedContent = json.dumps(messageContent, separators=(',', ':')).encode('utf-8')
    encodedLength = struct.pack('@I', len(encodedContent))
    return {'length': encodedLength, 'content': encodedContent}


def sendMessage(encodedMessage):
    """
        Send an encoded message to stdout
    """
    sys.stdout.buffer.write(encodedMessage['length'])
    sys.stdout.buffer.write(encodedMessage['content'])
    sys.stdout.buffer.flush()


session_id = uuid.uuid4()
bus = SessionBus()
broker = bus.get(
        "com.microsoft.identity.broker1",
        "/com/microsoft/identity/broker1")

while True:
    receivedMessage = getMessage()
    if receivedMessage == "acquirePrtSsoCookie":
        sendMessage(encodeMessage(acquirePrtSsoCookie(broker)))
