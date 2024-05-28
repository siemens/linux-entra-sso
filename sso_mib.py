#!/usr/bin/env -S python3 -u

# Note that running python with the `-u` flag is required on Windows,
# in order to ensure that stdin and stdout are opened in binary, rather
# than text, mode.

import sys
import json
import struct
from pydbus import SessionBus
import uuid

def acquirePrtSsoCookie(broker):
    context = {
        'clientId': str(session_id),
        'redirectUri': str(session_id)
    }
    resp = json.loads(broker.getAccounts('0.0', str(session_id), json.dumps(context)))

    account = resp['accounts'][0]
    request = {
        'account': account,
        'authParameters': {
            'accessTokenToRenew': '',
            'account': resp['accounts'][0],
            'additionalQueryParametersForAuthorization': {},
            'authority': f'https://login.microsoftonline.com/common',
            'authorizationType': 8, #OAUTH2
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
        'ssoUrl': f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/authorize'
    }
    token = json.loads(broker.acquirePrtSsoCookie('0.0', str(session_id), json.dumps(request)))
    return token

# Read a message from stdin and decode it.
def getMessage():
    rawLength = sys.stdin.buffer.read(4)
    if len(rawLength) == 0:
        sys.exit(0)
    messageLength = struct.unpack('@I', rawLength)[0]
    message = sys.stdin.buffer.read(messageLength).decode('utf-8')
    return json.loads(message)

# Encode a message for transmission,
# given its content.
def encodeMessage(messageContent):
    # https://docs.python.org/3/library/json.html#basic-usage
    # To get the most compact JSON representation, you should specify
    # (',', ':') to eliminate whitespace.
    # We want the most compact representation because the browser rejects # messages that exceed 1 MB.
    encodedContent = json.dumps(messageContent, separators=(',', ':')).encode('utf-8')
    encodedLength = struct.pack('@I', len(encodedContent))
    return {'length': encodedLength, 'content': encodedContent}

# Send an encoded message to stdout
def sendMessage(encodedMessage):
    sys.stdout.buffer.write(encodedMessage['length'])
    sys.stdout.buffer.write(encodedMessage['content'])
    sys.stdout.buffer.flush()

TENANT = "38ae3bcd-9579-4fd4-adda-b42e1495d55a" # SIEMENS AG
session_id = uuid.uuid4()
bus = SessionBus()
broker = bus.get(
        "com.microsoft.identity.broker1",
        "/com/microsoft/identity/broker1"
    )

while True:
    receivedMessage = getMessage()
    if receivedMessage == "acquirePrtSsoCookie":
        sendMessage(encodeMessage(acquirePrtSsoCookie(broker)))
