<!--
SPDX-FileCopyrightText: Copyright 2025 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->
# System-Wide Install via Policy

We support both system-wide installation and managed configuration.

## Host Components

Linux distributions can include the host components by packaging the output of `make install` (using `DESTDIR` is supported).
This makes the host parts available to all users, but requires the use of signed extension versions.

The native messaging directories differ across Linux distributions.
The variables `(firefox|chrome|chromium)_nm_dir` and `chrome_ext_dir` must be configured appropriately.
The Python interpreter (shebang) is determined at install time to avoid runtime dependencies on venvs.
This can be adjusted by setting `python3_bin`.
The default values are suitable for a Debian system. For more information, refer to the `Makefile`.

## Webextension

On Chrome, the `make install` target takes care of registering the extension to be auto-installed when starting the browser.

On other browsers, the installation of the extension is controlled via a policy.
The paths of the policy files may vary across browsers and distributions.
On Debian, the following paths are known to work.

### Firefox

Example: `/etc/firefox/policies/policies.json`

```json
{
  "policies": {
    "ExtensionSettings": {
      "linux-entra-sso@example.com": {
        "installation_mode": "force_installed",
        "install_url": "file:///path/to/extension.xpi"
      }
    }
  }
}
```

### Chromium

Example: `/etc/chromium/policies/managed/policies.json`

```json
{
  "ExtensionSettings": {
    "jlnfnnolkbjieggibinobhkjdfbpcohn": {
      "runtime_allowed_hosts": ["https://login.microsoftonline.com"],
      "installation_mode": "force_installed",
      "update_url": "file:///path/to/chrome-update.xml"
    }
  }
}
```

Chrome Update (`chrome-update.xml`) file:

```xml
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='jlnfnnolkbjieggibinobhkjdfbpcohn'>
    <updatecheck codebase='file:///path/to/extension.crx' version=pinned-version' />
  </app>
</gupdate>
```

## Configuration

We implement the `storage.managed` webextension API to allow injection of configuration.
By that, a system administrator can configure settings of the extension via the policy files.

> [!NOTE]
> Some settings cannot be automatically enabled (e.g., granting permissions), as they require
> user interaction. In this case, the extension detects a configuration update and notifies
> the user via the tray icon. The user can then apply the changes by clicking a link in the
> tray menu.

### Managed settings

The settings are added to the policy file under `3rdparty.extensions.<id>`. Example:


```json
{
  "3rdparty": {
    "extensions": {
      "linux-entra-sso@example.com": {
        "wellKnownApps": {
          "example.com": true,
        }
      }
    }
  }
}
```

#### `wellKnownApps`

To allow background SSO, the extension needs the `host_permissions` for both the application
domain, as well as for the login provider. Hereby, the app domain can be anything, but is
usually known to the company managing the devices.

Value: Dictionary of key-value pairs (string, bool), where the key is the domain and the
value denotes if SSO is enabled. The domain must precisely match. Wildcards are not (yet)
supported.

```json
{
  "wellKnownApps": {
    "example.com": true,
    "another.example.com": false
  }
}
```
