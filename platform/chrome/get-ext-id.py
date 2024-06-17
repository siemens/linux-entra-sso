#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright 2024 Siemens AG
# SPDX-License-Identifier: MPL-2.0
#
# Compute the extension ID from the path of the extension
# (for unpacked extensions).

import hashlib
import sys
import os

if len(sys.argv) != 2:
    print('Usage: python get-ext-id.py <path>')

PATH = os.path.realpath(sys.argv[1])
m = hashlib.sha256()
m.update(bytes(PATH.encode('utf-8')))
EXTID = ''.join([chr(int(i, base=16) + ord('a')) for i in m.hexdigest()][:32])
print(EXTID)
