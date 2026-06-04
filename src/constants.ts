/**
 * Shared constants for paperclip-spend-guard.
 *
 * Centralised so the manifest, the worker, and any tests agree on the exact
 * plugin id, tool name, event names, and state namespace. Plugin ids and tool
 * names are part of the host's namespacing contract (PLUGIN_SPEC §9, §11.1) and
 * must stay stable once published.
 */

/**
 * Globally-unique plugin id. The spec recommends this equal the npm package
 * name (PLUGIN_SPEC §10.1). It also becomes the prefix the host uses to
 * namespace this plugin's tool and emitted-event names.
 */
export const PLUGIN_ID = "paperclip-spend-guard";

/** Plugin version — kept in lockstep with package.json `version`. */
export const PLUGIN_VERSION = "0.1.0";

/**
 * The agent tool spend-guard contributes. Agents call it to see how much budget
 * they (and the current issue / today) have left. The host exposes it to agents
 * namespaced as `paperclip-spend-guard:spend_guard_status`.
 */
export const TOOL_NAME = "spend_guard_status";

/**
 * Bare names for the plugin-namespaced events spend-guard emits when a ceiling
 * threshold is crossed. The host rewrites these to
 * `plugin.paperclip-spend-guard.<name>` (PLUGIN_SPEC §16.2). Other plugins (or
 * a future UI) can subscribe to react to guardrail events.
 */
export const EMIT_EVENTS = {
  /** Fired when a bucket first crosses the warn ratio. */
  thresholdWarn: "threshold.warn",
  /** Fired when a bucket first reaches/exceeds its ceiling. */
  thresholdAlert: "threshold.alert",
  /** Fired when opt-in enforcement actually paused an agent. */
  agentPaused: "agent.paused",
} as const;

/**
 * Sub-namespace used for all of this plugin's `ctx.state` keys, so spend-guard
 * data never collides with another namespace inside the same scope row
 * (plugin_state is unique on (plugin, scope_kind, scope_id, namespace, key) —
 * PLUGIN_SPEC §21.3).
 */
export const STATE_NAMESPACE = "spend-guard";

/**
 * Fixed state keys. Bucket totals are stored under the relevant scope
 * (agent/issue/instance-day), all sharing the same `stateKey` because the scope
 * itself disambiguates them. The "last emitted alert level" rows live under a
 * separate key so emit de-duplication state is kept apart from totals.
 */
export const STATE_KEYS = {
  totals: "totals",
  lastLevel: "last-level",
} as const;

/**
 * Default warn ratio surfaced to the operator and used when config omits it.
 * Mirrors core/budget DEFAULT_WARN_RATIO; duplicated as a literal here only so
 * the manifest's JSON schema `default` can reference a plain value.
 */
export const DEFAULT_WARN_RATIO = 0.8;
