<!--
SPDX-FileCopyrightText: Copyright 2024 Siemens AG
SPDX-License-Identifier: MPL-2.0
-->

# Contributing to linux-entra-sso

Contributions are always welcome. This document explains the
general requirements on contributions and the recommended preparation
steps.

## Contribution Checklist

- use git to manage your changes [*recommended*]
- follow Python coding style outlined in pep8 [**required**]
- add signed-off to all patches [**required**]
    - to certify the "Developer's Certificate of Origin", see below
    - check with your employer when not working on your own!
- post follow-up version(s) if feedback requires this
- send reminder if nothing happened after about a week
- when adding new files, add a license header (see existing files) [**required**]

Developer's Certificate of Origin 1.1
-------------------------------------

When signing-off a patch for this project like this

    Signed-off-by: Random J Developer <random@developer.example.org>

using your real name (no pseudonyms or anonymous contributions), you declare the
following:

    By making a contribution to this project, I certify that:

        (a) The contribution was created in whole or in part by me and I
            have the right to submit it under the open source license
            indicated in the file; or

        (b) The contribution is based upon previous work that, to the best
            of my knowledge, is covered under an appropriate open source
            license and I have the right under that license to submit that
            work with modifications, whether created in whole or in part
            by me, under the same open source license (unless I am
            permitted to submit under a different license), as indicated
            in the file; or

        (c) The contribution was provided directly to me by some other
            person who certified (a), (b) or (c) and I have not modified
            it.

        (d) I understand and agree that this project and the contribution
            are public and that a record of the contribution (including all
            personal information I submit with it, including my sign-off) is
            maintained indefinitely and may be redistributed consistent with
            this project or the open source license(s) involved.

## Testing

Please test the extension on all supported platforms (browsers).
If you cannot test on a platform (e.g., because you don't have it), clearly state this.
We also provide a mock implementation of the backend part, which can be installed using `make local-install-mock`.
This mock processes and returns syntactically valid data via the native messaging protocol,
enabling testing of features like multi-account support that are otherwise difficult to test.
It does not require a `microsoft-identity-broker` to be running but also does not issue valid tokens.

## Maintainers: Create Releases

The creation of public releases is a partially automated process:

1. update code and create release tags: `VERSION=<x.x.x> make release`
2. push to GitHub: `git push origin main && git push origin v<x.x.x>`
3. wait for release action to finish (public release is created)
4. add release-notes to public release
5. manually inspect signed xpi (double check)
6. merge auto-created MR to enroll Firefox update manifest
7. publish CWS upload (answer questions on permission changes)
8. wait for CWS to review and sign extension, upload `.crx` to releases page
