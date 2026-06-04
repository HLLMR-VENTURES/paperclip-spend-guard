# Contributing to `paperclip-spend-guard`

Thanks for taking the time to contribute. This is a **plugin for
[Paperclip](https://github.com/paperclipai/paperclip)** that adds cost
visibility and budget guardrails for an agent workforce. It runs as an
out-of-process plugin worker against the official `@paperclipai/plugin-sdk` —
there are no API keys and no secret refs.

This guide covers everything you need to get a development environment running,
make a change, and open a pull request that's easy to review and merge.

## Table of contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [Development workflow](#development-workflow)
- [How the test suite works](#how-the-test-suite-works)
- [Running the plugin against a local Paperclip instance](#running-the-plugin-against-a-local-paperclip-instance)
- [Coding conventions](#coding-conventions)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)
- [Security](#security)
- [License](#license)

## Prerequisites

- **Node.js >= 20.** The package is ESM-only and targets modern Node.
- **npm** (ships with Node). The repo is committed with an npm lockfile.
- A running **Paperclip instance** (with instance-admin access) only if you want
  to install and exercise the plugin end to end. Unit tests require **no**
  instance, key, or network access.

## Getting started

```sh
git clone https://github.com/HLLMR/paperclip-spend-guard.git
cd paperclip-spend-guard
npm install
npm run typecheck   # fast type-only pass, no emit
npm test            # compiles + runs the node:test unit tests
npm run build       # emits dist/
```

If all four commands pass on a clean clone, your environment is ready.

## Project layout

```
src/
  index.ts            # barrel: re-exports manifest + worker
  manifest.ts         # PaperclipPluginManifestV1 — capabilities, config schema, tool
  worker.ts           # the ONLY module that touches @paperclipai/plugin-sdk;
                      #   subscribes to events, drives the core, persists state,
                      #   emits alerts, runs opt-in enforcement, serves the tool
  constants.ts        # plugin id, tool name, event names, state namespace/keys
  core/               # pure, SDK-free, fully unit-tested logic
    types.ts          # domain shapes (decoupled from the SDK on purpose)
    parse.ts          # host event payload -> normalised SpendObservation
    ledger.ts         # fold observations into per-bucket SpendTotals
    budget.ts         # ceilings -> alert level + emit-dedup decision
    *.test.ts         # node:test unit tests, colocated with the code they cover
```

The split is deliberate: `core/` knows nothing about Paperclip and is trivially
testable; `worker.ts` is the thin, contract-specific wiring layer. Keep new
business logic in `core/` with tests, and keep `worker.ts` focused on
translation and I/O.

## Development workflow

The npm scripts are the source of truth — please don't bypass them.

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — strict type check, no output. Run this constantly. |
| `npm test` | `tsc` (full compile to `dist/`) then the cross-version `node:test` runner over `dist/`. |
| `npm run build` | `tsc -p tsconfig.build.json` — production emit to `dist/` (excludes test files). |
| `npm run clean` | removes `dist/`. |

## How the test suite works

Tests are written with the built-in **`node:test`** runner and `node:assert` —
no third-party framework to learn.

- Test files are colocated with the code they cover and named `*.test.ts`.
- `npm test` first runs `tsc`, compiling the whole `src/` tree (tests included)
  into `dist/`, then runs `scripts/run-tests.mjs`, which discovers the compiled
  `*.test.js` files and runs them through the stable programmatic `node:test`
  runner. **The runner executes the compiled JavaScript in `dist/`, not the
  TypeScript sources.**
- Because tests run after a real `tsc` pass, a type error fails `npm test` before
  any test executes. A green `npm test` means the project both type-checks and
  behaves.

Keep unit tests hermetic — no Paperclip instance, no network. The pure functions
in `core/` are designed to be tested directly. For worker-level behavior, the
official SDK harness (`@paperclipai/plugin-sdk/testing` → `createTestHarness`)
can drive `setup`, dispatch events, call tools, and read state in-memory.

## Running the plugin against a local Paperclip instance

Plugin install is an **instance-admin** operation.

1. Build the plugin: `npm run build`.
2. Install your local build (local-path install loads `dist/` from disk):

   ```sh
   curl -X POST "$PAPERCLIP_API_URL/api/plugins/install" \
     -H "Authorization: Bearer <instance-admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"packageName": "'"$PWD"'", "isLocalPath": true}'
   ```

3. Approve the requested capabilities, then configure ceilings in
   Settings → Plugins → Spend Guard.
4. Drive some agent runs / budget activity and watch the per-agent / per-issue /
   per-day attribution and the `spend_guard_status` tool.

For pure logic changes you usually don't need a live instance — the `node:test`
suite plus `npm run typecheck` cover most cases.

## Coding conventions

- **TypeScript, strict.** `tsconfig.json` enables `strict` and
  `noUncheckedIndexedAccess`. Don't loosen compiler options to make code
  compile; fix the types. Avoid `any` — prefer precise types and `unknown` at
  boundaries.
- **ESM only.** The package is `"type": "module"` with `verbatimModuleSyntax`.
  Use file extensions in relative imports (`Node16` resolution) and `import type`
  for type-only imports.
- **Keep pure logic in `core/`.** New attribution / budget / parsing behavior
  belongs in a small, tested function there, not inline in the worker.
- **Be honest about the host contract.** This plugin documents exactly which
  host events fire vs. don't (see the README "Contract notes"). If you change
  what the plugin assumes about host behavior, verify it against the real host
  and update those notes.
- **Comment the why.** This codebase favors thorough comments explaining intent
  and contract specifics over terse code. Match that.

## Commit messages

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<optional scope>): <short summary>
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.

Examples:

```
feat(budget): add per-project ceilings
fix(parse): tolerate stringified amountObserved
docs: clarify cost_event.created wiring status
test(ledger): cover day-bucket UTC rollover
```

Mark breaking changes with `!` and a `BREAKING CHANGE:` footer.

## Pull request process

1. Fork and create a topic branch off `main`.
2. Make your change with accompanying tests and doc updates.
3. Ensure the local gate passes: `npm run typecheck` and `npm test`.
4. Use a **Conventional Commit** PR title and fill out the pull request template.
5. Link the issue your PR addresses (`Closes #123`).
6. Keep PRs focused and reasonably small.

Squash-and-merge is the default, so the PR title becomes the commit on `main` —
make it a good Conventional Commit.

## Reporting bugs and requesting features

Please use the GitHub issue forms. Open issues at
<https://github.com/HLLMR/paperclip-spend-guard/issues>.

## Security

Do **not** open public issues for security problems. See [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
