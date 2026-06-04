/**
 * Plugin manifest for paperclip-spend-guard.
 *
 * The manifest is the install-time contract: the host reads it, shows the
 * operator the requested `capabilities`, renders the settings form from
 * `instanceConfigSchema`, and registers the declared `tools`. It is loaded
 * without running the worker, so it must be a static value (PLUGIN_SPEC §10.1).
 *
 * Capability choices (every one is required by something concrete below):
 *   - events.subscribe   -> subscribe to budget.incident.* and agent.run.finished
 *   - events.emit        -> emit our own threshold.warn / threshold.alert events
 *   - plugin.state.read  -> read prior bucket totals
 *   - plugin.state.write -> persist updated bucket totals
 *   - agent.tools.register -> contribute the spend_guard_status tool
 *   - costs.read         -> read-only access to host cost data (used defensively;
 *                           see worker — kept in the set so future cost lookups
 *                           do not require a capability re-approval)
 *   - agents.pause       -> ONLY exercised when the operator opts into
 *                           `pauseAgentOnCeiling`; declared up front because
 *                           capabilities are static and install-time visible.
 *
 * NOTE on secrets: spend-guard declares NO secret refs and NO http.outbound. It
 * derives everything from Paperclip's own event stream and state store, which
 * is exactly what the `PLUGIN_SECRET_REFS_DISABLED` kill switch on this build
 * requires. There is nothing for that switch to break.
 */

import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  TOOL_NAME,
  DEFAULT_WARN_RATIO,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Spend Guard",
  description:
    "Cost visibility and budget guardrails for an agent workforce on metered models. " +
    "Attributes reported spend per agent, per issue, and per day; alerts at warn/ceiling " +
    "thresholds; optional opt-in pause-on-ceiling enforcement. No API keys or secret refs required.",
  author: "HLLMR",
  // automation: it reacts to events and enforces policy. (Not a UI plugin in
  // v0.1.0 — see README for why the spend panel is deferred.)
  categories: ["automation"],

  capabilities: [
    "events.subscribe",
    "events.emit",
    "plugin.state.read",
    "plugin.state.write",
    "agent.tools.register",
    "costs.read",
    "agents.pause",
  ],

  entrypoints: {
    // No `ui` entrypoint in v0.1.0 — this is a headless automation plugin.
    worker: "./dist/worker.js",
  },

  /**
   * Operator settings. Rendered by the host as an auto-generated form at
   * /settings/plugins/paperclip-spend-guard (PLUGIN_SPEC §19.8). All ceilings
   * are optional — omitting one means "track but never alert" for that scope.
   */
  instanceConfigSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      perAgentUsd: {
        type: "number",
        minimum: 0,
        title: "Per-agent ceiling (USD)",
        description:
          "Alert when a single agent's attributed spend reaches this many dollars. Leave empty for no per-agent ceiling.",
      },
      perIssueUsd: {
        type: "number",
        minimum: 0,
        title: "Per-issue ceiling (USD)",
        description:
          "Alert when a single issue/task's attributed spend reaches this many dollars. Leave empty for no per-issue ceiling.",
      },
      perDayUsd: {
        type: "number",
        minimum: 0,
        title: "Per-day ceiling (USD)",
        description:
          "Alert when total attributed spend for a UTC day reaches this many dollars. Leave empty for no per-day ceiling.",
      },
      warnRatio: {
        type: "number",
        minimum: 0.01,
        maximum: 1,
        default: DEFAULT_WARN_RATIO,
        title: "Warn threshold (fraction of ceiling)",
        description:
          "Emit a warning when spend reaches this fraction of a ceiling (e.g. 0.8 = warn at 80%). The full alert fires at 100%.",
      },
      pauseAgentOnCeiling: {
        type: "boolean",
        default: false,
        title: "Pause agent on per-agent ceiling (opt-in enforcement)",
        description:
          "When enabled, spend-guard pauses an agent once it crosses its per-agent ceiling. " +
          "Default OFF (alert-only). Pausing is agent-scoped, so this applies to the per-agent ceiling only.",
      },
    },
  },

  /**
   * The agent-facing tool. Parameters are optional context hints; the host also
   * passes a `ToolRunContext` (agentId/issueId via run context) to the handler,
   * which is the authoritative source for "who is asking".
   */
  tools: [
    {
      name: TOOL_NAME,
      displayName: "Spend Guard status",
      description:
        "Report this agent's current attributed spend and remaining budget (per agent, " +
        "per issue, and for today), so the agent can self-throttle before hitting a ceiling.",
      parametersSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          issueId: {
            type: "string",
            description:
              "Optional issue id to report per-issue budget for. Defaults to the issue of the current run when available.",
          },
        },
      },
    },
  ],
};

export default manifest;
