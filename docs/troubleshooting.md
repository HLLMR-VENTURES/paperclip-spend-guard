# Troubleshooting

## Dollar figures look too high / don't match my real cost

Expected in the current Paperclip build. Spend-guard's primary dollar signal is
**budget-incident** events, which report the host's *observed total* for a scope
at distinct thresholds rather than per-run increments. Attribution is therefore
**approximate and biased toward over-reporting** — the safe direction for a
guardrail. Run **counts** and threshold behavior are exact.

Precise per-run dollar attribution activates automatically if/when the host
begins emitting `cost_event.created` (spend-guard already parses and prefers it).
See the README "Contract notes".

## No alerts are firing

Check, in order:

1. **A ceiling is configured.** With no `perAgentUsd` / `perIssueUsd` /
   `perDayUsd`, spend-guard tracks but never alerts. The plugin's "Test
   Connection" warns about this.
2. **The events are reaching the plugin.** Spend-guard only sees spend via
   `budget.incident.*` (and `agent.run.finished` for run counts). If your
   Paperclip instance has no active budget policies, no budget incidents are
   emitted — so there's no dollar signal to alert on. Configure a Paperclip
   budget policy, or wait for `cost_event.created` to be wired.
3. **The level actually increased.** Alerts only fire on an *increase* in
   severity (`ok → warn → alert`). If a bucket is already at `alert`, repeated
   events won't re-emit.

## `spend_guard_status` shows `$0` for an agent that has clearly run

`agent.run.finished` increments the **run count** but contributes `$0` (its
payload carries no cost in this build). Dollars only appear once a
budget-incident (or a future `cost_event.created`) attributes them. Check the
`runCount` in the tool's structured `data` to confirm runs are being seen.

## The plugin won't install

- Plugin install is an **instance-admin** operation. A loopback/authenticated
  session is not automatically admin.
- The operator must approve the requested capabilities at install time
  (`events.subscribe`, `events.emit`, `plugin.state.read`, `plugin.state.write`,
  `agent.tools.register`, `costs.read`, `agents.pause`).

## An agent was paused unexpectedly

If `pauseAgentOnCeiling` is enabled, spend-guard pauses an agent at its per-agent
ceiling and emits `plugin.paperclip-spend-guard.agent.paused`. Disable the option
for alert-only behavior, raise the `perAgentUsd` ceiling, or resume the agent
through the normal Paperclip controls. (Note Paperclip core may also pause a
scope independently on its own hard budget stop.)
