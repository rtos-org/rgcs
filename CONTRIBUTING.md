# Contributing to RGCS

Thank you for helping. Bug reports, ideas, documentation and code are all welcome, in English or
Japanese.

## Before you start

- **Security problems**: never in a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bugs and ideas**: open an issue. For a bug, give the RGCS version, the vehicle type and
  ArduPilot version (or SITL), what you did, what you expected and what happened, plus logs or
  screenshots where they help.
- **Larger changes**: open an issue first so we can agree on the approach before you write a lot
  of code.

## Contributor License Agreement

Before we can merge your first pull request, you need to agree to the
[RGCS Contributor License Agreement](CLA.md). The CLA bot comments on your pull request with a
link; agreeing takes a minute and covers your later contributions.

You keep the copyright in your work. You give RtoS Co., Ltd. a licence to use it in RGCS, including
under other licences, so RtoS can keep developing and supporting the project. RtoS must always
also keep your contribution available under the licence RGCS used when you contributed (the GNU
AGPL v3 or later with the RGCS Plugin Exception). The [CLA](CLA.md) has the exact terms.

Plugins do not need the CLA: you publish them yourself, under any licence (see
[PLUGINS.md](PLUGINS.md)).

## Development

The [README](README.md#quick-start-development) explains the setup: Rust, Node.js 22 and Docker
for ArduPilot SITL. Then:

- **Write the test first.** Every change comes with tests: Rust unit and integration tests,
  Vitest for the UI, Playwright for user journeys. Tests make no network calls and no real AI
  calls: use the fixtures and local fakes.
- **Run the checks before you push**:
  ```sh
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test --workspace
  cd apps/rgcs-server/ui && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test -- --run
  ```
- **Keep changes small and focused.** Prefer files under 400 lines and functions under 50 lines,
  and keep state immutable.
- **Code, comments and commit messages are in English.** UI text goes through the dictionaries in
  `apps/rgcs-server/ui/src/shared/i18n`, in all four languages. A test fails if a language misses
  a key.
- **UI conventions**:
  - Icons come from Lucide only, never text glyphs (a test checks this).
  - Ask for confirmation inside the app, never with `window.confirm`.
  - `styles/prototype.css` is generated: change the other stylesheets instead.
- **Safety first.** A change that can send commands to a vehicle, write parameters or missions,
  or change the confirmation rules needs tests for the refusal paths too, and a clear note in the
  pull request.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(ui): …`, `fix(server): …`, `docs: …`.
- **Generated TypeScript types**: if you change Rust types shared with the UI, run
  `cargo test -p rgcs-core` and commit the regenerated files in
  `apps/rgcs-server/ui/src/shared/api/generated`.

## Pull requests

- Describe what changed and why, and how you tested it (SITL, hardware, which vehicle types).
- Screenshots help for UI changes.
- CI must pass. A maintainer reviews every change before it is merged.

By contributing you agree that your contributions are licensed as described in the CLA, and you
follow the [trademark policy](TRADEMARKS.md) when you publish forks or services.
