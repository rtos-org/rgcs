# RGCS licence notice and plugin note

```
RGCS
Copyright (C) 2026 RtoS Co., Ltd.

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at https://mozilla.org/MPL/2.0/.

The full text of the Mozilla Public License, v. 2.0 is in the file
LICENSE.
```

## Plugins are separate works

Earlier versions of this file carried a plugin exception to the GNU AGPL.
RGCS is now licensed under the Mozilla Public License, v. 2.0 ("MPL"),
whose copyleft is file-level, so no exception is needed. This note records
the same intent as a clarification, not as an additional permission:

- "Plugin Interface" means the plugin formats and interfaces documented in
  the file PLUGINS.md distributed with RGCS, including the plugin manifest
  format and any host APIs and HTTP endpoints that the file documents for
  use by plugins.

- "Plugin" means a work that:
    a) communicates with RGCS solely through the Plugin Interface;
    b) can be installed and removed without modifying RGCS; and
    c) contains no part of RGCS other than the declarations needed to use
       the Plugin Interface and material copied from the examples in
       PLUGINS.md or in the examples/plugins directory.

A Plugin is material in separate files that does not contain Covered
Software, so the MPL does not reach it: you may publish a Plugin under
terms of your choice, and combining RGCS with Plugins does not change the
licence of either side. RGCS itself, and any file of RGCS that you modify
or any new file that contains RGCS code, remain subject to the MPL.

This note grants no right to the data or services a Plugin refers to, such
as map tiles provided by a third party. Their terms are the responsibility
of the Plugin's author and users.
