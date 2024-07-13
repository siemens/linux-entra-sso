#
# Entra ID SSO via Microsoft Identity Broker on Linux
#
# SPDX-License-Identifier: MPL-2.0
# SPDX-FileCopyrightText: Copyright (c) Jan Kiszka, 2020-2024
# SPDX-FileCopyrightText: Copyright (c) Siemens AG, 2024
#
# Authors:
#  Jan Kiszka <jan.kiszka@siemens.com>
#  Felix Moessbauer <felix.moessbauer@siemens.com>
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

prefix ?= /usr/local
exec_prefix ?= $(prefix)
libexecdir ?= $(exec_prefix)/libexec
# do not prefix with $(prefix) as these dirs are defined by the browsers
firefox_nm_dir ?= /usr/lib/mozilla/native-messaging-hosts
chrome_nm_dir ?= /etc/opt/chrome/native-messaging-hosts
chrome_ext_dir ?= /usr/share/google-chrome/extensions
chromium_nm_dir ?= /etc/chromium/native-messaging-hosts

ifeq ($(V),1)
	Q =
else
	Q = @
endif

PACKAGE_NAME=Linux-Entra-SSO

RELEASE_TAG=$(shell git describe --match "v[0-9].[0-9]*" --dirty)
ARCHIVE_NAME=$(PACKAGE_NAME)-$(RELEASE_TAG)

COMMON_INPUT_FILES= \
	LICENSES/MPL-2.0.txt \
	background.js

CHROME_INPUT_FILES= \
	$(COMMON_INPUT_FILES) \
	platform/chrome/manifest.json \
	platform/chrome/manifest.json.license \
	icons/linux-entra-sso_48.png \
	icons/linux-entra-sso_48.png.license \
	icons/linux-entra-sso_128.png \
	icons/linux-entra-sso_128.png.license

FIREFOX_INPUT_FILES= \
	$(COMMON_INPUT_FILES) \
	platform/firefox/manifest.json \
	platform/firefox/manifest.json.license \
	icons/linux-entra-sso.svg

# common files for all platforms (relative to build directory)
CHROME_PACKAGE_FILES= \
	$(COMMON_INPUT_FILES) \
	manifest.json \
	manifest.json.license \
	icons/linux-entra-sso_48.png \
	icons/linux-entra-sso_48.png.license \
	icons/linux-entra-sso_128.png \
	icons/linux-entra-sso_128.png.license

FIREFOX_PACKAGE_FILES= \
	$(COMMON_INPUT_FILES) \
	manifest.json \
	manifest.json.license \
	icons/linux-entra-sso.svg

UPDATE_VERSION='s|"version":.*|"version": "$(VERSION)",|'

CHROME_EXT_ID=$(shell $(CURDIR)/platform/chrome/get-ext-id.py $(CURDIR)/build/chrome/)
CHROME_EXT_ID_SIGNED=jlnfnnolkbjieggibinobhkjdfbpcohn

all package: clean $(CHROME_INPUT_FILES) $(FIREFOX_INPUT_FILES)
	for P in firefox chrome; do \
		mkdir -p build/$$P/icons; \
		cp platform/$$P/manifest* build/$$P; \
		cp -rf LICENSES background.js build/$$P/; \
	done
	cp icons/*.svg build/firefox/icons/
	cp icons/*.png* build/chrome/icons/
	cd build/firefox && zip -r ../$(ARCHIVE_NAME).firefox.xpi $(FIREFOX_PACKAGE_FILES) && cd ../../;
	cd build/chrome && zip -r ../$(ARCHIVE_NAME).chrome.zip $(CHROME_PACKAGE_FILES) && cd ../../;

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
	sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.mozilla/|' ~/.mozilla/native-messaging-hosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.mozilla

local-install-chrome:
	install -d ~/.config/google-chrome/NativeMessagingHosts
	install -d ~/.config/chromium/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/google-chrome/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/chromium/NativeMessagingHosts
	sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.config/google-chrome/|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.config/google-chrome/|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	# compute extension id and and grant permission
	sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.config/google-chrome

local-install: local-install-firefox local-install-chrome

install:
	# Host application
	install -d $(DESTDIR)/$(libexecdir)/linux-entra-sso
	install -m 0755 linux-entra-sso.py $(DESTDIR)/$(libexecdir)/linux-entra-sso
	# Firefox
	install -d $(DESTDIR)/$(firefox_nm_dir)
	install -m 0644 platform/firefox/linux_entra_sso.json $(DESTDIR)/$(firefox_nm_dir)
	sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(firefox_nm_dir)/linux_entra_sso.json
	# Chrome
	install -d $(DESTDIR)/$(chrome_nm_dir)
	install -m 0644 platform/chrome/linux_entra_sso.json $(DESTDIR)/$(chrome_nm_dir)
	sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json
	sed -i '/{extension_id}/d' $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json
	install -d $(DESTDIR)/$(chrome_ext_dir)
	install -m 0644 platform/chrome/extension.json $(DESTDIR)/$(chrome_ext_dir)/$(CHROME_EXT_ID_SIGNED).json
	# Chromium
	install -d $(DESTDIR)/$(chromium_nm_dir)
	install -m 0644 platform/chrome/linux_entra_sso.json $(DESTDIR)/$(chromium_nm_dir)
	sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(chromium_nm_dir)/linux_entra_sso.json
	sed -i '/{extension_id}/d' $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json

uninstall:
	rm -rf $(DESTDIR)/$(libexecdir)/linux-entra-sso
	rm -f  $(DESTDIR)/$(firefox_nm_dir)/linux_entra_sso.json
	rm -f  $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json
	rm -f  $(DESTDIR)/$(chromium_nm_dir)/linux_entra_sso.json
	rm -f  $(DESTDIR)/$(chrome_ext_dir)/$(CHROME_EXT_ID_SIGNED).json

local-uninstall-firefox:
	rm -f ~/.mozilla/native-messaging-hosts/linux_entra_sso.json ~/.mozilla/linux-entra-sso.py

local-uninstall-chrome:
	rm -f ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json ~/.config/google-chrome/linux-entra-sso.py
	rm -f ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json

local-uninstall: local-uninstall-firefox local-uninstall-chrome

.PHONY: clean release local-install-firefox local-install-chrome local-install install local-uninstall-firefox local-uninstall-chrome local-uninstall uninstall
