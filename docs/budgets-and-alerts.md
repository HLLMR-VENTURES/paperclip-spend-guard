# Budgets, alerts, and enforcement

## How a threshold is decided

For each bucket (agent / issue / day) with a configured ceiling, spend-guard
computes a level from the bucket's attributed spend:

| Condition | Level |
|---|---|
| `spent >= limit` | `alert` |
| `spent >= limit * warnRatio` | `warn` |
| otherwise | `ok` |

`warnRatio` defaults to `0.8`. A bucket with no configured ceiling is always
`ok` (tracked, never alerted).

## Alert events

When a bucket's level first **increases** (e.g. `ok → warn`, `warn → alert`,
`ok → alert`), spend-guard emits a plugin-namespaced event:

- `plugin.paperclip-spend-guard.threshold.warn`
- `plugin.paperclip-spend-guard.threshold.alert`

Payload:

```jsonc
{
  "scope": "agent",          // "agent" | "issue" | "day"
  "scopeId": "agent-uuid",   // agentId, issueId, or YYYY-MM-DD
  "spentUsd": 90,
  "limitUsd": 100,
  "ratio": 0.9,
  "level": "warn",
  "agentId": "agent-uuid",   // when known
  "issueId": "iss-uuid"      // when known
}
```

### De-duplication / idempotency

Paperclip delivers events **at least once** (the same incident may be redelivered
after a retry). Spend-guard persists the last-emitted level per bucket and only
emits on a genuine **increase** in severity, so redelivery and repeated incidents
at the same level never produce duplicate alerts. A de-escalation (`alert → warn`)
is recorded but does not emit; a later real re-escalation will fire again.

Subscribe to these events from another plugin with
`ctx.events.on("plugin.paperclip-spend-guard.threshold.alert", handler)`.

## Opt-in enforcement (`pauseAgentOnCeiling`)

When enabled, and **only** for the **per-agent** ceiling at the full `alert`
level, spend-guard calls the host's `agents.pause(agentId, companyId)`:

1. The agent's bucket reaches its per-agent ceiling.
2. spend-guard pauses the agent via the `agents.pause` capability.
3. It emits `plugin.paperclip-spend-guard.agent.paused` with the agent id and
   the spend/limit that triggered it.

Defaults and limits:

- **Default OFF.** With enforcement disabled, spend-guard is alert-only and never
  mutates host state.
- **Per-agent only.** Pausing is an agent-level action; there is no host
  capability to pause an issue or a day.
- **Best-effort.** If the pause call fails (e.g. the agent is already terminated),
  spend-guard logs the error and degrades to alert-only rather than retrying.
- **Complements, does not replace, core enforcement.** Paperclip core owns hard
  budget stops (it pauses/cancels a scope at a hard ceiling itself). This opt-in
  is an additional, plugin-level guardrail.

To resume a paused agent, use the normal Paperclip controls (or another tool with
the `agents.resume` capability).
