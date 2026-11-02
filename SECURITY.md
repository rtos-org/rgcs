# Security policy

RGCS sends commands to real aircraft over a network. Please report security problems privately, so
they can be fixed before they are known.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it through GitHub's private vulnerability reporting: open this repository's **Security**
tab and choose **Report a vulnerability**. Only you and the maintainers can see the report.

Please include:
- the RGCS version or commit;
- how it was deployed: Pi or desktop, how port 8000 is reachable, the `role` and `mavlink_url`
  kind, and whether the development login is still active;
- the steps to reproduce, or a proof of concept;
- what an attacker gains, for example commands to a vehicle, parameter or mission writes, account
  access, or reading data.

## What happens next

- We acknowledge the report within 14 days.
- We confirm the problem, agree on its severity with you, and work on a fix in a private
  advisory.
- We publish the fix and a GitHub security advisory together. With your permission, we credit
  you in it.
- Please keep the details private until the advisory is published. If a fix will take longer
  than 90 days, we will tell you why and agree on a date with you.

## Supported versions

RGCS is in early development (0.x). Only the latest release and the `main` branch get security
fixes.

## Scope

In scope:
- `rgcs-server`: its HTTP / WebSocket API, authentication and sessions, the CSRF guard,
  command confirmation, and the parsing of MAVLink and camera traffic;
- the web UI;
- the deployment files in `deploy/`;
- the plugin loader and the fetching of plugin overlay tiles.

Known and documented, so not a vulnerability by itself:
- The development login `admin` / `admin` is active on a fresh install until accounts are
  created. The README and the deployment guide say to keep port 8000 on the vehicle LAN or a VPN.
  A way **around** a login, or to a command without one, is in scope.

Out of scope:
- Third-party plugins: report them to their authors.
- Vulnerabilities in dependencies, ArduPilot, MediaMTX or camera firmware: report them upstream.
  Tell us as well when the way RGCS uses them makes the problem exploitable.
- Safety bugs that are not security problems, such as a wrong value on screen: open a normal
  issue. If a bug could make RGCS send an unintended command to a vehicle, report it privately as
  above.

## 日本語

脆弱性は公開の Issue などには書かず、このリポジトリの **Security** タブ →
**Report a vulnerability**(GitHub の非公開報告)から報告してください。日本語での報告も受け付けます。
2 週間以内に受け付けの返事をし、修正と公表は報告者と調整して行います。
