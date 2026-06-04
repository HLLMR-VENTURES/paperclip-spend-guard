# Security Policy

`paperclip-spend-guard` is a plugin for
[Paperclip](https://github.com/paperclipai/paperclip) that adds cost attribution
and budget guardrails. It holds **no credentials** and makes **no outbound
network calls** — it operates entirely on Paperclip's own domain events and
plugin state store. Even so, it can request that the host **pause an agent**
(opt-in), so we take security reports seriously.

## Supported Versions

Security fixes are provided for the latest released minor on the current major.
Older majors receive critical fixes on a best-effort basis only.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub Security Advisories:

➡️ https://github.com/HLLMR/paperclip-spend-guard/security/advisories/new

When reporting, please include where practical:

- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) of the plugin, Paperclip, and Node.js.
- Any relevant configuration (with anything sensitive redacted).

### Response window

- **Acknowledgement:** within 3 business days of your report.
- **Triage and severity assessment:** within 7 business days.
- **Fix or mitigation plan:** communicated as soon as triage completes; timelines
  depend on severity and complexity.

### Responsible disclosure

- Give us a reasonable opportunity to investigate and ship a fix before any
  public disclosure.
- Do not access, modify, or exfiltrate data that is not yours, and do not
  degrade service for other users while testing.
- Act in good faith and avoid privacy violations or destruction of data.

We are happy to credit reporters in the advisory unless you prefer to remain
anonymous.

## Security Model

Understanding the plugin's trust boundaries will help you assess and report
issues accurately.

### No secrets, no network

- The plugin declares **no** `secrets.read-ref` and **no** `http.outbound`
  capability. It never reads secret material and never calls external services.
- All inputs come from the host: capability-gated domain events
  (`budget.incident.*`, `agent.run.finished`, `cost_event.created`) and the
  plugin's own `plugin_state` rows.

### Capabilities requested

The plugin requests exactly these, shown to the operator at install time:
`events.subscribe`, `events.emit`, `plugin.state.read`, `plugin.state.write`,
`agent.tools.register`, `costs.read`, and `agents.pause`. The host enforces
these in the SDK layer — the plugin cannot call host APIs outside this set.

### Agent pause is opt-in

- `agents.pause` is the only mutating capability the plugin exercises, and it is
  used **only** when the operator explicitly enables `pauseAgentOnCeiling`
  (default OFF). When disabled, the plugin is alert-only and never mutates host
  state.
- Even when enabled, pausing is **best-effort and agent-scoped**, fired only when
  an agent reaches its configured per-agent ceiling. A pause failure degrades to
  alert-only rather than retrying or escalating.
- Hard budget enforcement (pause-and-cancel at a hard ceiling) remains owned by
  **Paperclip core**, not this plugin. Spend-guard does not and cannot override
  core budget, approval, or checkout invariants.

### Untrusted event input

- Host event payloads are treated as **untrusted** at the boundary: every field
  is parsed defensively (`core/parse.ts`), malformed payloads never throw, and a
  missing company scope is dropped rather than mis-attributed.
- Spend attribution from budget incidents is **approximate and biased toward
  over-reporting** (the safe direction for a guardrail). It must not be relied on
  as an authoritative financial ledger; Paperclip's own cost records are the
  source of truth.

### Emitted events

- The plugin emits only plugin-namespaced events
  (`plugin.paperclip-spend-guard.*`) carrying budget figures and entity ids. It
  writes no secret material into events, state, or logs.

If you believe any of these boundaries can be bypassed, please report it via the
private advisory link above.
