#
# Firefox Intune Plugin
#
# Copyright (c) Jan Kiszka, 2020-2024
# Copyright (c) Siemens AG, 2024
#
# Authors:
#  Jan Kiszka <jan.kiszka@siemens.de>
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

ifeq ($(V),1)
	Q =
else
	Q = @
endif

PACKAGE_NAME=sso-mib

RELEASE_TAG=$(shell git describe --match "v[0-9].[0-9]*" --dirty)
ARCHIVE_NAME=$(PACKAGE_NAME)-$(RELEASE_TAG).xpi

PACKAGE_FILES= \
	background.js \
	manifest.json \
	icons/sso-mib.png

UPDATE_VERSION='s|"version":.*|"version": "$(VERSION)",|'

all package: clean $(PACKAGE_FILES)
	zip -r $(ARCHIVE_NAME) $(PACKAGE_FILES)

clean:
	rm -f $(ARCHIVE_NAME)

release:
	${Q}if [ -z "$(VERSION)" ]; then		\
		echo "VERSION is not set";		\
		exit 1;					\
	fi
	${Q}if [ -n "`git status -s -uno`" ]; then	\
		echo "Working directory is dirty!";	\
		exit 1;					\
	fi
	${Q}sed -i $(UPDATE_VERSION) manifest.json
	git commit -s manifest.json -m "Bump version number"
	git tag -as v$(VERSION) -m "Release v$(VERSION)"

local-install:
	install -d ~/.mozilla/native-messaging-hosts
	install -m 0644 sso_mib.json ~/.mozilla/native-messaging-hosts
	sed -i 's|/usr/local/lib/mozilla/|'$(HOME)'/.mozilla/|' ~/.mozilla/native-messaging-hosts/sso_mib.json
	install -m 0755 sso-mib.py ~/.mozilla

local-uninstall:
	rm -f ~/.mozilla/native-messaging-hosts/sso_mib.json ~/.mozilla/sso-mib.py

.PHONY: clean release local-install local-uninstall
