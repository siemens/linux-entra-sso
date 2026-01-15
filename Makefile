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
# python3 system interpreter for global installs
python3_bin ?= $(shell which python3)

ifeq ($(V),1)
	Q =
else
	Q = @
endif

PACKAGE_NAME=Linux-Entra-SSO

RELEASE_TAG ?= $(shell git describe --match "v[0-9].[0-9]*" --dirty)
WEBEXT_VERSION=$(shell echo $(RELEASE_TAG) | sed -e s:^v::)
ARCHIVE_NAME=$(PACKAGE_NAME)-$(RELEASE_TAG)

COMMON_INPUT_FILES= \
	LICENSES/MPL-2.0.txt \
	src/account.js \
	src/background.js \
	src/broker.js \
	src/device.js \
	src/platform.js \
	src/policy.js \
	src/utils.js \
	icons/profile-outline_48.png \
	icons/profile-outline_48.png.license \
	popup/menu.css \
	popup/menu.js \
	popup/menu.html

CHROME_INPUT_FILES= \
	$(COMMON_INPUT_FILES) \
	platform/chrome/manifest.json \
	platform/chrome/manifest.json.license \
	platform/chrome/js/platform-chrome.js \
	platform/chrome/js/platform-factory.js \
	platform/chrome/storage-schema.json \
	platform/chrome/storage-schema.json.license \
	icons/linux-entra-sso_48.png \
	icons/linux-entra-sso_48.png.license \
	icons/linux-entra-sso_128.png \
	icons/linux-entra-sso_128.png.license

FIREFOX_INPUT_FILES= \
	$(COMMON_INPUT_FILES) \
	platform/firefox/manifest.json \
	platform/firefox/manifest.json.license \
	platform/firefox/js/platform-firefox.js \
	platform/firefox/js/platform-factory.js \
	icons/linux-entra-sso.svg \
	icons/profile-outline.svg

THUNDERBIRD_INPUT_FILES= \
	$(COMMON_INPUT_FILES) \
	platform/thunderbird/manifest.json \
	platform/thunderbird/manifest.json.license \
	platform/thunderbird/js/platform-thunderbird.js \
	platform/thunderbird/js/platform-factory.js \
	icons/linux-entra-sso.svg \
	icons/profile-outline.svg

# common files for all platforms (relative to build directory)
CHROME_PACKAGE_FILES= \
	$(COMMON_INPUT_FILES) \
	src/platform-chrome.js \
	src/platform-factory.js \
	manifest.json \
	manifest.json.license \
	storage-schema.json \
	storage-schema.json.license \
	icons/linux-entra-sso_48.png \
	icons/linux-entra-sso_48.png.license \
	icons/linux-entra-sso_128.png \
	icons/linux-entra-sso_128.png.license \
	popup/profile-outline.svg

FIREFOX_PACKAGE_FILES= \
	$(COMMON_INPUT_FILES) \
	src/platform-firefox.js \
	src/platform-factory.js \
	manifest.json \
	manifest.json.license \
	icons/linux-entra-sso.svg \
	popup/profile-outline.svg

THUNDERBIRD_PACKAGE_FILES= \
	$(FIREFOX_PACKAGE_FILES) \
	src/platform-thunderbird.js

UPDATE_VERSION='s|"version":.*|"version": "$(VERSION)",|'
UPDATE_VERSION_PY='s|0.0.0-dev|$(WEBEXT_VERSION)|g'
UPDATE_PYTHON_INTERPRETER='1,1s:^\#!.*:\#!$(python3_bin):'

CHROME_EXT_ID=$(shell $(CURDIR)/platform/chrome/get-ext-id.py $(CURDIR)/build/chrome/)
CHROME_EXT_ID_SIGNED=jlnfnnolkbjieggibinobhkjdfbpcohn

# debian package related vars
DEBIAN_PV = $(shell echo $(RELEASE_TAG) | sed -e s:^v::)
DEBIAN_PN = linux-entra-sso
DEBIAN_DESCRIPTION = Entra ID SSO via Microsoft Identity Broker on Linux
DEBIAN_DESTDIR := $(CURDIR)/debuild.d
DEBIAN_ARCH = all
DEBIAN_PKG_DIR = $(CURDIR)/pkgs
DEBIAN_PKG_FILE = $(DEBIAN_PKG_DIR)/$(DEBIAN_PN)_$(DEBIAN_PV)_$(DEBIAN_ARCH).deb

all package: clean $(CHROME_INPUT_FILES) $(FIREFOX_INPUT_FILES) $(THUNDERBIRD_INPUT_FILES)
	for P in firefox thunderbird chrome; do \
		mkdir -p build/$$P/icons build/$$P/popup; \
		cp platform/$$P/manifest* build/$$P; \
		cp -rf LICENSES src build/$$P/; \
		cp platform/$$P/js/* build/$$P/src; \
	done
	cp -r build/firefox/icons build/firefox/popup build/thunderbird/
	cp platform/chrome/storage* build/chrome/
	cp icons/*.svg icons/profile-outline_48.* build/firefox/icons/
	cp icons/*.png* icons/profile-outline.svg build/chrome/icons/
	cp popup/menu.* icons/linux-entra-sso.svg icons/profile-outline.svg build/firefox/popup/
	cp popup/menu.* icons/linux-entra-sso.svg icons/profile-outline.svg build/chrome/popup/
# thunderbird is almost identical to Firefox
	cp -r build/firefox/icons build/firefox/popup build/thunderbird/
	cp build/firefox/src/platform-firefox.js build/thunderbird/src/
	cd build/firefox && zip -r ../$(ARCHIVE_NAME).firefox.xpi $(FIREFOX_PACKAGE_FILES) && cd ../../;
	cd build/thunderbird && zip -r ../$(ARCHIVE_NAME).thunderbird.xpi $(THUNDERBIRD_PACKAGE_FILES) && cd ../../;
	cd build/chrome && zip -r ../$(ARCHIVE_NAME).chrome.zip $(CHROME_PACKAGE_FILES) && cd ../../;

deb:
	$(MAKE) install DESTDIR=$(DEBIAN_DESTDIR) python3_bin=/usr/bin/python3 prefix=/usr
	install --mode 644 -D --target-directory=$(DEBIAN_DESTDIR)/usr/share/doc/$(DEBIAN_PN) README.md CONTRIBUTING.md MAINTAINERS.md PRIVACY.md LICENSES/MPL-2.0.txt
	install --mode 755 --directory $(DEBIAN_DESTDIR)/DEBIAN
	{ \
		echo Package: $(DEBIAN_PN); \
		echo Architecture: $(DEBIAN_ARCH); \
		echo Section: admin; \
		echo Priority: optional; \
		echo 'Maintainer: Dr. Johann Pfefferl <johann.pfefferl@siemens.com>'; \
		echo Installed-Size: `du --summarize $(DEBIAN_DESTDIR) | cut --fields=1`; \
		echo 'Depends: python3-pydbus, python3-gi'; \
		echo Version: $(DEBIAN_PV); \
		echo Description: $(DEBIAN_DESCRIPTION); \
	} > $(DEBIAN_DESTDIR)/DEBIAN/control
	install --mode 775 --directory $(DEBIAN_PKG_DIR)
	dpkg-deb --deb-format=2.0 --root-owner-group --build $(DEBIAN_DESTDIR) $(DEBIAN_PKG_DIR)
	@echo Package can be found here: $(DEBIAN_PKG_FILE)

deb_clean:
	rm -rf $(DEBIAN_PKG_DIR) $(DEBIAN_DESTDIR)

clean: deb_clean
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
	git commit -s platform/firefox/manifest.json platform/thunderbird/manifest.json platform/chrome/manifest.json -m "Bump version number"
	git tag -as v$(VERSION) -m "Release v$(VERSION)"

local-install-firefox:
	install -d ~/.mozilla/native-messaging-hosts
	install -m 0644 platform/firefox/linux_entra_sso.json ~/.mozilla/native-messaging-hosts
	${Q}sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.mozilla/|' ~/.mozilla/native-messaging-hosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.mozilla
	${Q}sed -i $(UPDATE_VERSION_PY) ~/.mozilla/linux-entra-sso.py

local-install-chrome:
	install -d ~/.config/google-chrome/NativeMessagingHosts
	install -d ~/.config/chromium/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/google-chrome/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/chromium/NativeMessagingHosts
	${Q}sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.config/google-chrome/|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	${Q}sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.config/google-chrome/|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	# compute extension id and and grant permission
	${Q}sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	${Q}sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.config/google-chrome
	${Q}sed -i $(UPDATE_VERSION_PY) ~/.config/google-chrome/linux-entra-sso.py

local-install-brave:
	install -d ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts
	install -m 0644 platform/chrome/linux_entra_sso.json ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts
	${Q}sed -i 's|/usr/local/lib/linux-entra-sso/|'$(HOME)'/.config/BraveSoftware/Brave-Browser/|' ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/linux_entra_sso.json
	# compute extension id and and grant permission
	${Q}sed -i 's|{extension_id}|$(CHROME_EXT_ID)|' ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/linux_entra_sso.json
	install -m 0755 linux-entra-sso.py ~/.config/BraveSoftware/Brave-Browser
	${Q}sed -i $(UPDATE_VERSION_PY) ~/.config/BraveSoftware/Brave-Browser/linux-entra-sso.py

local-install: local-install-firefox local-install-chrome local-install-brave

# For testing, we provide a mock implementation of the broker communication
local-install-mock: local-install
	install -m 0755 tests/linux_entra_sso_mock.py ~/.mozilla
	${Q}sed -i 's|linux-entra-sso.py|linux_entra_sso_mock.py|' ~/.mozilla/native-messaging-hosts/linux_entra_sso.json
	install -m 0755 tests/linux_entra_sso_mock.py ~/.config/google-chrome
	${Q}sed -i 's|linux-entra-sso.py|linux_entra_sso_mock.py|' ~/.config/google-chrome/NativeMessagingHosts/linux_entra_sso.json
	${Q}sed -i 's|linux-entra-sso.py|linux_entra_sso_mock.py|' ~/.config/chromium/NativeMessagingHosts/linux_entra_sso.json
	install -m 0755 tests/linux_entra_sso_mock.py ~/.config/BraveSoftware/Brave-Browser
	${Q}sed -i 's|linux-entra-sso.py|linux_entra_sso_mock.py|' ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/linux_entra_sso.json

install:
	${Q}[ -z "$(python3_bin)" ] && { echo "python3 not found. Please set 'python3_bin'."; exit 1; } || true
	# Host application
	install -d $(DESTDIR)/$(libexecdir)/linux-entra-sso
	install -m 0755 linux-entra-sso.py $(DESTDIR)/$(libexecdir)/linux-entra-sso
	${Q}sed -i $(UPDATE_VERSION_PY) $(DESTDIR)/$(libexecdir)/linux-entra-sso/linux-entra-sso.py
	${Q}sed -i $(UPDATE_PYTHON_INTERPRETER) $(DESTDIR)/$(libexecdir)/linux-entra-sso/linux-entra-sso.py
	# Firefox
	install -d $(DESTDIR)/$(firefox_nm_dir)
	install -m 0644 platform/firefox/linux_entra_sso.json $(DESTDIR)/$(firefox_nm_dir)
	${Q}sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(firefox_nm_dir)/linux_entra_sso.json
	# Chrome
	install -d $(DESTDIR)/$(chrome_nm_dir)
	install -m 0644 platform/chrome/linux_entra_sso.json $(DESTDIR)/$(chrome_nm_dir)
	${Q}sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json
	${Q}sed -i '/{extension_id}/d' $(DESTDIR)/$(chrome_nm_dir)/linux_entra_sso.json
	install -d $(DESTDIR)/$(chrome_ext_dir)
	install -m 0644 platform/chrome/extension.json $(DESTDIR)/$(chrome_ext_dir)/$(CHROME_EXT_ID_SIGNED).json
	# Chromium
	install -d $(DESTDIR)/$(chromium_nm_dir)
	install -m 0644 platform/chrome/linux_entra_sso.json $(DESTDIR)/$(chromium_nm_dir)
	${Q}sed -i 's|/usr/local/lib/|'$(libexecdir)/'|' $(DESTDIR)/$(chromium_nm_dir)/linux_entra_sso.json
	${Q}sed -i '/{extension_id}/d' $(DESTDIR)/$(chromium_nm_dir)/linux_entra_sso.json

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

local-uninstall-brave:
	rm -f ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/linux_entra_sso.json ~/.config/BraveSoftware/Brave-Browser/linux-entra-sso.py

local-uninstall: local-uninstall-firefox local-uninstall-chrome local-uninstall-brave

.PHONY: clean release deb deb_clean
.PHONY: local-install-firefox local-install-chrome local-install-brave local-install local-install-mock install
.PHONY: local-uninstall-firefox local-uninstall-chrome local-uninstall-brave local-uninstall uninstall
