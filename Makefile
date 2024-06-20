#
# Firefox Intune Plugin
#
# SPDX-License-Identifier: MPL-2.0
# SPDX-FileCopyrightText: Copyright (c) Jan Kiszka, 2020-2024
# SPDX-FileCopyrightText: Copyright (c) Siemens AG, 2024
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

PACKAGE_NAME=Linux-Entra-SSO

RELEASE_TAG=$(shell git describe --match "v[0-9].[0-9]*" --dirty)
ARCHIVE_NAME=$(PACKAGE_NAME)-$(RELEASE_TAG).xpi

COMMON_FILES= \
	LICENSES/MPL-2.0.txt \
	background.js \
	icons/linux-entra-sso.svg

MANIFEST_FILES= \
	platform/firefox/manifest.json \
	platform/firefox/manifest.json.license \
	platform/chrome/manifest.json \
	platform/chrome/manifest.json.license

PACKAGE_FILES= \
	$(COMMON_FILES) \
	manifest.json \
	manifest.json.license

UPDATE_VERSION='s|"version":.*|"version": "$(VERSION)",|'

CHROME_EXT_ID=$(shell $(CURDIR)/platform/chrome/get-ext-id.py $(CURDIR)/build/chrome/)

all package: clean $(COMMON_FILES) $(MANIFEST_FILES)
	for P in firefox chrome; do \
		mkdir -p build/$$P; \
		cp platform/$$P/manifest* build/$$P; \
		cp -rf icons LICENSES background.js build/$$P/; \
	done
	cd build/firefox && zip -r $(ARCHIVE_NAME) $(PACKAGE_FILES) && cd ../../;

clean:
	rm -rf build

release:
	${Q}if [ -z "$(VERSION)" ]; then		\
		echo "VERSION is not set";		\
		exit 1;					\
	fi
	${Q}if [ -n "`git status -s -uno`" ]; then	\
		echo "Working directory is dirty!";	\
		exit 1;					\
	fi
	${Q}sed -i $(UPDATE_VERSION) platform/*/manifest.json
	git commit -s platform/firefox/manifest.json platform/chrome/manifest.json -m "Bump version number"
	git tag -as v$(VERSION) -m "Release v$(VERSION)"

local-install-firefox:
	install -d ~/.mozilla/native-messaging-hosts
	install -m 0644 platform/firefox/linux_entra_sso.json ~/.mozilla/native-messaging-hosts
	sed -i 's|/usr/local/lib/mozilla/|'$(HOME)'/.mozilla/|' ~/.mozilla/native-messaging-hosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.mozilla

local-install-chrome:
	install -d ~/.config/google-chrome/NativeMessagingHosts
	install -d ~/.config/chromium/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/google-chrome/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/chromium/NativeMessagingHosts
	sed -i 's|/usr/local/lib/chrome/|'$(HOME)'/.config/google-chrome/|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	sed -i 's|/usr/local/lib/chrome/|'$(HOME)'/.config/google-chrome/|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	# compute extension id and and grant permission
	sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.config/google-chrome

local-uninstall-firefox:
	rm -f ~/.mozilla/native-messaging-hosts/linux_entra_sso.json ~/.mozilla/linux-entra-sso.py

local-uninstall-chrome:
	rm -f ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json ~/.config/google-chrome/linux-entra-sso.py
	rm -f ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json

.PHONY: clean release local-install-firefox local-install-chrome local-uninstall-firefox local-uninstall-chrome
