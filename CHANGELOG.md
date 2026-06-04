# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-04

Initial release.

### Added

- Paperclip **plugin** (`paperclip-spend-guard`) targeting the shipped plugin
  runtime via `@paperclipai/plugin-sdk`. No API keys or secret refs required —
  compatible with `PLUGIN_SECRET_REFS_DISABLED` builds.
- **Spend attribution** across three independent ledgers — per agent, per issue,
  and per UTC day (rolling) — persisted in `plugin_state`. Tracks dollars, token
  usage, and run counts.
- **Event ingestion** for `budget.incident.opened`, `budget.incident.resolved`
  (primary dollar signal in the current build) and `agent.run.finished` (run
  counts / per-issue activity). Also parses `cost_event.created` so precise
  per-run dollar attribution works the moment the host wires that event.
- **Configurable budgets**: per-agent, per-issue, and per-day USD ceilings (any
  subset) plus a configurable warn ratio (default `0.8`).
- **Threshold alerts** emitted as plugin events
  (`plugin.paperclip-spend-guard.threshold.warn` / `…threshold.alert`), with
  de-duplication so at-least-once event redelivery does not spam.
- **`spend_guard_status` agent tool** so an agent can read its own attributed
  spend and remaining budget (agent / issue / today) mid-run and self-throttle.
- **Opt-in `pauseAgentOnCeiling` enforcement** (default OFF) that calls
  `agents.pause` when an agent reaches its per-agent ceiling, with a
  `…agent.paused` event and graceful degradation to alert-only on failure.
- `node:test` unit coverage for the pure attribution, budget-evaluation, and
  event-parsing logic.

[Unreleased]: https://github.com/HLLMR/paperclip-spend-guard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HLLMR/paperclip-spend-guard/releases/tag/v0.1.0
