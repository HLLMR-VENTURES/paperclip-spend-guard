/**
 * Worker entrypoint for paperclip-spend-guard.
 *
 * This is the ONLY module that touches the Paperclip plugin SDK. Its job is to
 * translate host events into the pure core shapes, drive the tested accounting
 * and budget-evaluation functions, persist totals in plugin state, and react
 * (emit threshold events, optionally pause an agent, answer the status tool).
 *
 * The host imports the default export, calls `setup(ctx)` once, and from then
 * on dispatches events/tool-calls to the handlers we register. `runWorker()`
 * wires up the JSON-RPC-over-stdio worker process the host spawns
 * (PLUGIN_SPEC §12.1) — without it the module is inert when launched directly.
 *
 * Idempotency: events are delivered at-least-once (PLUGIN_SPEC §13.5). Totals
 * are additive so duplicates inflate spend slightly in the "more visible"
 * direction, and alert emission is de-duplicated via the last-emitted-level
 * row so we never spam on redelivery.
 */

import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEvent,
  type PluginHealthDiagnostics,
  type ScopeKey,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";

import {
  PLUGIN_ID,
  TOOL_NAME,
  EMIT_EVENTS,
  STATE_NAMESPACE,
  STATE_KEYS,
} from "./constants.js";
import { parseSpendEvent, type RawPluginEvent } from "./core/parse.js";
import {
  coerceTotals,
  applyObservation,
  dayKey,
} from "./core/ledger.js";
import {
  normalizeBudgetConfig,
  evaluateBucket,
  shouldEmit,
} from "./core/budget.js";
import type {
  AlertLevel,
  BudgetConfig,
  BudgetEvaluation,
  SpendObservation,
  SpendTotals,
} from "./core/types.js";

// ---------------------------------------------------------------------------
// State-key helpers
//
// Every bucket is a distinct plugin_state row. We disambiguate buckets purely
// by scope: an agent bucket is scoped to that agent, an issue bucket to that
// issue, and a day bucket to the instance scope with the day folded into the
// namespace (there is no "day" scope kind, so we encode it in the namespace).
// ---------------------------------------------------------------------------

function agentTotalsKey(agentId: string): ScopeKey {
  return { scopeKind: "agent", scopeId: agentId, namespace: STATE_NAMESPACE, stateKey: STATE_KEYS.totals };
}

function issueTotalsKey(issueId: string): ScopeKey {
  return { scopeKind: "issue", scopeId: issueId, namespace: STATE_NAMESPACE, stateKey: STATE_KEYS.totals };
}

function dayTotalsKey(day: string): ScopeKey {
  // Day buckets have no dedicated scope kind; fold the day into the namespace
  // under the instance scope so each UTC day is its own unique row.
  return { scopeKind: "instance", namespace: `${STATE_NAMESPACE}:day:${day}`, stateKey: STATE_KEYS.totals };
}

/** Companion "last emitted alert level" row for a given totals key. */
function lastLevelKey(base: ScopeKey): ScopeKey {
  return { ...base, stateKey: STATE_KEYS.lastLevel };
}

// ---------------------------------------------------------------------------
// State read/write wrappers (the only I/O in this file lives behind these)
// ---------------------------------------------------------------------------

async function readTotals(ctx: PluginContext, key: ScopeKey, now: string): Promise<SpendTotals> {
  const raw = await ctx.state.get(key);
  return coerceTotals(raw, now);
}

async function writeTotals(ctx: PluginContext, key: ScopeKey, totals: SpendTotals): Promise<void> {
  await ctx.state.set(key, totals);
}

async function readLastLevel(ctx: PluginContext, base: ScopeKey): Promise<AlertLevel> {
  const raw = await ctx.state.get(lastLevelKey(base));
  return raw === "warn" || raw === "alert" ? raw : "ok";
}

async function writeLastLevel(ctx: PluginContext, base: ScopeKey, level: AlertLevel): Promise<void> {
  await ctx.state.set(lastLevelKey(base), level);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

async function loadConfig(ctx: PluginContext): Promise<BudgetConfig> {
  const raw = (await ctx.config.get()) as BudgetConfig;
  return normalizeBudgetConfig(raw);
}

// ---------------------------------------------------------------------------
// Threshold handling for a single bucket
//
// Given a freshly-updated bucket and its ceiling, evaluate the level, and — if
// the severity *increased* since we last emitted for this bucket — emit the
// matching plugin event and (for agent ceilings under opt-in enforcement) pause
// the agent. Returns the evaluation so the caller can log/aggregate it.
// ---------------------------------------------------------------------------

async function handleThreshold(
  ctx: PluginContext,
  config: BudgetConfig,
  base: ScopeKey,
  evaluation: BudgetEvaluation | null,
  obs: SpendObservation,
): Promise<void> {
  if (!evaluation) return; // no ceiling configured for this scope

  const previous = await readLastLevel(ctx, base);
  if (!shouldEmit(previous, evaluation.level)) {
    // Either unchanged or de-escalating; persist the (possibly lower) level so
    // a later real escalation re-fires, but emit nothing.
    if (evaluation.level !== previous) await writeLastLevel(ctx, base, evaluation.level);
    return;
  }

  // Severity increased — record it first so a redelivered event won't re-emit.
  await writeLastLevel(ctx, base, evaluation.level);

  const eventName =
    evaluation.level === "alert" ? EMIT_EVENTS.thresholdAlert : EMIT_EVENTS.thresholdWarn;

  // Emit a plugin-namespaced event other plugins / a future UI can react to.
  await ctx.events.emit(eventName, obs.companyId, {
    scope: evaluation.scope,
    scopeId: evaluation.scopeId,
    spentUsd: evaluation.spentUsd,
    limitUsd: evaluation.limitUsd,
    ratio: evaluation.ratio,
    level: evaluation.level,
    agentId: obs.agentId ?? null,
    issueId: obs.issueId ?? null,
  });

  ctx.logger.warn(`spend-guard ${evaluation.level} on ${evaluation.scope} ${evaluation.scopeId}`, {
    spentUsd: evaluation.spentUsd,
    limitUsd: evaluation.limitUsd,
  });

  // ---- Opt-in enforcement: pause the agent at the per-agent ceiling --------
  // Only for agent-scope alerts, only when the operator enabled it, and only at
  // the full "alert" level (ceiling reached). Pausing is wrapped so a failure
  // (e.g. agent already terminated) degrades to alert-only rather than crashing
  // the handler.
  if (
    config.pauseAgentOnCeiling &&
    evaluation.scope === "agent" &&
    evaluation.level === "alert" &&
    obs.agentId
  ) {
    try {
      await ctx.agents.pause(obs.agentId, obs.companyId);
      await ctx.events.emit(EMIT_EVENTS.agentPaused, obs.companyId, {
        agentId: obs.agentId,
        reason: "spend-guard per-agent ceiling reached",
        spentUsd: evaluation.spentUsd,
        limitUsd: evaluation.limitUsd,
      });
      ctx.logger.warn(`spend-guard paused agent ${obs.agentId} at ceiling`, {
        spentUsd: evaluation.spentUsd,
        limitUsd: evaluation.limitUsd,
      });
    } catch (err) {
      ctx.logger.error("spend-guard failed to pause agent; staying alert-only", {
        agentId: obs.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The core fold: apply one observation to all relevant buckets and run
// threshold handling for each. Shared by every event handler.
// ---------------------------------------------------------------------------

async function ingest(ctx: PluginContext, config: BudgetConfig, obs: SpendObservation): Promise<void> {
  // Per-agent bucket.
  if (obs.agentId) {
    const key = agentTotalsKey(obs.agentId);
    const next = applyObservation(await readTotals(ctx, key, obs.occurredAt), obs);
    await writeTotals(ctx, key, next);
    await handleThreshold(
      ctx,
      config,
      key,
      evaluateBucket("agent", obs.agentId, next.costUsd, config.perAgentUsd, config.warnRatio),
      obs,
    );
  }

  // Per-issue bucket.
  if (obs.issueId) {
    const key = issueTotalsKey(obs.issueId);
    const next = applyObservation(await readTotals(ctx, key, obs.occurredAt), obs);
    await writeTotals(ctx, key, next);
    await handleThreshold(
      ctx,
      config,
      key,
      evaluateBucket("issue", obs.issueId, next.costUsd, config.perIssueUsd, config.warnRatio),
      obs,
    );
  }

  // Per-day bucket (always — every observation lands on some UTC day).
  const day = dayKey(obs.occurredAt);
  const dayKeyScope = dayTotalsKey(day);
  const nextDay = applyObservation(await readTotals(ctx, dayKeyScope, obs.occurredAt), obs);
  await writeTotals(ctx, dayKeyScope, nextDay);
  await handleThreshold(
    ctx,
    config,
    dayKeyScope,
    evaluateBucket("day", day, nextDay.costUsd, config.perDayUsd, config.warnRatio),
    obs,
  );
}

// ---------------------------------------------------------------------------
// Tool: spend_guard_status
//
// Lets an agent read its own remaining budget mid-run so it can self-throttle.
// The run context (agentId, issueId via runCtx) is authoritative for "who is
// asking"; an explicit issueId param can override the issue dimension.
// ---------------------------------------------------------------------------

function remaining(spent: number, limit: number | undefined): number | null {
  return typeof limit === "number" && limit > 0 ? Math.max(0, limit - spent) : null;
}

async function statusTool(
  ctx: PluginContext,
  config: BudgetConfig,
  params: unknown,
  runCtx: ToolRunContext,
): Promise<ToolResult> {
  const now = new Date().toISOString();
  const p = (typeof params === "object" && params !== null ? params : {}) as { issueId?: string };
  const issueId = typeof p.issueId === "string" && p.issueId.length > 0 ? p.issueId : undefined;

  const agentTotals = await readTotals(ctx, agentTotalsKey(runCtx.agentId), now);
  const day = dayKey(now);
  const dayTotals = await readTotals(ctx, dayTotalsKey(day), now);
  const issueTotals = issueId ? await readTotals(ctx, issueTotalsKey(issueId), now) : null;

  const summary = {
    agent: {
      agentId: runCtx.agentId,
      spentUsd: agentTotals.costUsd,
      limitUsd: config.perAgentUsd ?? null,
      remainingUsd: remaining(agentTotals.costUsd, config.perAgentUsd),
      runCount: agentTotals.runCount,
    },
    today: {
      day,
      spentUsd: dayTotals.costUsd,
      limitUsd: config.perDayUsd ?? null,
      remainingUsd: remaining(dayTotals.costUsd, config.perDayUsd),
    },
    issue: issueTotals
      ? {
          issueId,
          spentUsd: issueTotals.costUsd,
          limitUsd: config.perIssueUsd ?? null,
          remainingUsd: remaining(issueTotals.costUsd, config.perIssueUsd),
        }
      : null,
  };

  // A compact human-readable line for the agent's transcript, plus the full
  // structured object for any programmatic use.
  const fmt = (n: number | null): string => (n === null ? "no ceiling" : `$${n.toFixed(2)}`);
  const content =
    `Spend so far — agent: $${summary.agent.spentUsd.toFixed(2)} (remaining ${fmt(summary.agent.remainingUsd)}); ` +
    `today: $${summary.today.spentUsd.toFixed(2)} (remaining ${fmt(summary.today.remainingUsd)})` +
    (summary.issue
      ? `; issue: $${summary.issue.spentUsd.toFixed(2)} (remaining ${fmt(summary.issue.remainingUsd)})`
      : "");

  return { content, data: summary };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_ID} setup starting`);

    // One config snapshot per event keeps us correct after operator edits even
    // when the host applies config without restarting the worker. (Config reads
    // are cheap host RPCs; we fetch fresh inside each handler.)

    // --- Subscribe to the events that carry real spend / run signal ---------
    // budget.incident.* is the authoritative dollar signal in this build;
    // agent.run.finished gives run counts + per-issue activity. We re-derive
    // RawPluginEvent from the SDK event (structurally compatible) and run it
    // through the pure parser.
    const onSpendEvent = async (event: PluginEvent): Promise<void> => {
      const obs = parseSpendEvent(event as unknown as RawPluginEvent);
      if (!obs) return;
      const config = await loadConfig(ctx);
      await ingest(ctx, config, obs);
    };

    ctx.events.on("budget.incident.opened", onSpendEvent);
    ctx.events.on("budget.incident.resolved", onSpendEvent);
    ctx.events.on("agent.run.finished", onSpendEvent);
    // Forward-compatible: if/when the host wires first-class per-run cost, we
    // already attribute it precisely — no code change required.
    ctx.events.on("cost_event.created", onSpendEvent);

    // --- Register the agent-facing status tool ------------------------------
    ctx.tools.register(
      TOOL_NAME,
      {
        displayName: "Spend Guard status",
        description:
          "Report this agent's current attributed spend and remaining budget (per agent, per issue, and for today).",
        parametersSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            issueId: { type: "string", description: "Optional issue id for per-issue budget." },
          },
        },
      },
      async (params, runCtx) => {
        const config = await loadConfig(ctx);
        return statusTool(ctx, config, params, runCtx);
      },
    );

    ctx.logger.info(`${PLUGIN_ID} setup complete`);
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    return { status: "ok", message: "spend-guard ready" };
  },

  /**
   * Validate operator config. The host calls this on save and via the
   * "Test Connection" button. We re-run our normaliser and surface a warning
   * when enforcement is on but there is no per-agent ceiling to enforce.
   */
  async onValidateConfig(rawConfig) {
    const config = normalizeBudgetConfig(rawConfig as BudgetConfig);
    const warnings: string[] = [];
    if (config.pauseAgentOnCeiling && config.perAgentUsd === undefined) {
      warnings.push(
        "Pause-on-ceiling is enabled but no per-agent ceiling is set, so nothing will ever be enforced.",
      );
    }
    if (
      config.perAgentUsd === undefined &&
      config.perIssueUsd === undefined &&
      config.perDayUsd === undefined
    ) {
      warnings.push("No ceilings configured — spend-guard will track spend but never alert.");
    }
    return { ok: true, warnings };
  },
});

export default plugin;

// Start the JSON-RPC worker loop when the host launches this module directly.
runWorker(plugin, import.meta.url);
