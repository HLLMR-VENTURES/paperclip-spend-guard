# paperclip-spend-guard

[![npm version](https://img.shields.io/npm/v/paperclip-spend-guard.svg)](https://www.npmjs.com/package/paperclip-spend-guard)
[![CI](https://github.com/HLLMR/paperclip-spend-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/HLLMR/paperclip-spend-guard/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/paperclip-spend-guard.svg)](https://www.npmjs.com/package/paperclip-spend-guard)
[![node](https://img.shields.io/node/v/paperclip-spend-guard.svg)](https://www.npmjs.com/package/paperclip-spend-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Paperclip](https://github.com/paperclipai/paperclip) **plugin** that gives an
agent workforce running on metered models (e.g. via
[paperclip-openrouter](https://github.com/HLLMR/paperclip-openrouter)) cost
visibility and budget guardrails — **with no API keys and no secret refs**.

Spend-guard subscribes to Paperclip's own cost-related domain events,
attributes spend **per agent**, **per issue/task**, and **per day** (rolling) in
plugin state, exposes an agent tool so an agent can check its remaining budget
mid-run, emits alert events when a ceiling is approached or crossed, and can
(opt-in) pause an agent that blows its per-agent ceiling.

## Why no secrets

Everything spend-guard needs comes from inside Paperclip: it reads the
host's budget-incident and run-completion events and persists totals in the
host's plugin state store. It declares **no** `http.outbound`, `secrets.read-ref`
or any external dependency. That makes it fully compatible with hardened builds
that run with `PLUGIN_SECRET_REFS_DISABLED` — there is no secret machinery for
that kill switch to disable.

## What it does (v0.1.0)

- **Attribution.** Every cost-bearing event is folded into three independent
  ledgers — per agent, per issue, and per UTC day — stored in `plugin_state`.
  Token usage is tracked alongside dollars when the host reports it.
- **Budgets.** Configure per-agent, per-issue, and per-day USD ceilings (any
  subset). A configurable warn ratio (default `0.8`) fires an early warning.
- **Alerts.** When a bucket first crosses a threshold, spend-guard emits a
  plugin event (`plugin.paperclip-spend-guard.threshold.warn` /
  `…threshold.alert`) that other plugins — or a future UI — can react to.
  Emission is de-duplicated so at-least-once event redelivery never spams.
- **Agent self-service tool.** Agents can call `spend_guard_status` to read
  their own spend and remaining budget (agent / issue / today) and self-throttle.
- **Opt-in enforcement.** If `pauseAgentOnCeiling` is enabled, spend-guard calls
  the host's `agents.pause` when an agent reaches its per-agent ceiling. **Default
  OFF (alert-only).**

## Contract notes — read this before trusting the numbers

This plugin targets the **current, shipped** Paperclip plugin runtime, not the
aspirational parts of `PLUGIN_SPEC.md`. The Paperclip cost contract is still
settling, and spend-guard is built to be honest about it:

- **`agent.run.finished` is emitted** by the host, but its payload carries **no
  cost** — only run / agent / issue identifiers. Spend-guard uses it for run
  counts and per-issue activity attribution, contributing `$0`.
- **`budget.incident.opened` / `budget.incident.resolved` are emitted** (mapped
  from the host's `budget.*_threshold_crossed` activity). Their payload carries
  the host's own computed `amountObserved` (billed cents) for a scope. **This is
  the primary dollar signal spend-guard can see in this build**, so per-agent /
  per-day dollar figures are driven by it. Because incidents report an *observed
  total* at distinct thresholds rather than per-run increments, dollar
  attribution is **approximate and biased toward over-reporting** — the safe
  direction for a guardrail.
- **`cost_event.created` is declared by the host but is not wired to fire** in
  this build (the `cost.reported` activity action is not forwarded to plugins).
  Spend-guard already parses it and prefers it when present, so the day the host
  starts emitting first-class per-run cost, **precise per-run dollar attribution
  works with no change to this plugin.**

In short: run **counts** and **threshold/guardrail behavior** are exact; precise
per-run **dollar** attribution is gated on the host wiring `cost_event.created`.

### A capability spend-guard wanted but the host gates differently

Hard budget **enforcement** (pausing/cancelling a scope at a hard ceiling) is
**owned by Paperclip core**, not by plugins — the host's own budget engine calls
its internal pause-and-cancel path on a hard threshold, and the spec explicitly
reserves "budget hard-stops" as a core, non-plugin concern. Spend-guard's opt-in
`agents.pause` is therefore a **best-effort, agent-scoped** complement to that
core behavior, not a replacement for it. There is no plugin capability to pause
an *issue* or a *day*, so enforcement is per-agent only.

## Install

> Plugin install is an **instance-admin** operation. A loopback session in an
> authenticated Paperclip instance is not automatically an admin.

### From the Paperclip UI

Settings → Plugins → Install from npm → `paperclip-spend-guard`

### From the API

```sh
curl -X POST "$PAPERCLIP_API_URL/api/plugins/install" \
  -H "Authorization: Bearer <instance-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"packageName": "paperclip-spend-guard"}'
```

On install, the operator is shown the requested capabilities
(`events.subscribe`, `events.emit`, `plugin.state.read`, `plugin.state.write`,
`agent.tools.register`, `costs.read`, `agents.pause`) and approves them.

## Configuration

Configured from Settings → Plugins → Spend Guard (auto-generated from the
manifest's `instanceConfigSchema`). All ceilings are optional — omit one to
"track but never alert" for that scope.

| Field | Default | Notes |
|---|---|---|
| `perAgentUsd` | — | Alert when one agent's attributed spend reaches this many dollars. |
| `perIssueUsd` | — | Alert when one issue/task's attributed spend reaches this. |
| `perDayUsd` | — | Alert when total attributed spend for a UTC day reaches this. |
| `warnRatio` | `0.8` | Warn at this fraction of a ceiling; full alert at 100%. |
| `pauseAgentOnCeiling` | `false` | Opt-in: pause an agent at its per-agent ceiling. |

See [docs/configuration.md](docs/configuration.md) and
[docs/budgets-and-alerts.md](docs/budgets-and-alerts.md).

## The `spend_guard_status` tool

Available to agents (namespaced by the host as
`paperclip-spend-guard:spend_guard_status`). With no arguments it reports the
calling agent's spend and the current day's spend; pass `issueId` to also get
that issue's budget. Example content returned to the agent:

```
Spend so far — agent: $130.00 (remaining $0.00); today: $130.00 (remaining $70.00); issue: $0.00 (remaining $50.00)
```

The full structured `data` payload accompanies the text for programmatic use.

## Develop

```sh
npm install
npm run typecheck
npm test          # compiles + runs node:test unit tests
npm run build     # emits dist/
```

The pure accounting / budget / parsing logic lives in `src/core/` with full
`node:test` coverage; `src/worker.ts` is the only module that touches the
Paperclip SDK. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[SECURITY.md](SECURITY.md).

## Provenance

Clean-room implementation built against the official `@paperclipai/plugin-sdk`
and the in-repo `PLUGIN_SPEC.md` / authoring guide. Structurally informed by the
first-party Paperclip example plugins (hello-world and kitchen-sink). Not
affiliated with the Paperclip maintainers.

## License

[MIT](LICENSE) — free for everyone, always.
