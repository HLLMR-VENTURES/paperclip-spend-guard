/**
 * Core domain types for paperclip-spend-guard.
 *
 * These types are deliberately *decoupled* from the Paperclip plugin SDK. The
 * pure attribution / budget-evaluation logic in this `core/` folder must be
 * testable with plain `node:test` and zero host dependencies, so it speaks in
 * these small, self-contained shapes. The worker layer (`src/worker.ts`) is the
 * only place that imports `@paperclipai/plugin-sdk`; it translates host events
 * into these shapes and feeds them through the pure functions below.
 *
 * Why this split matters: the Paperclip cost contract is still settling (see
 * README "Contract notes" — `cost_event.created` is declared by the host but
 * not yet wired to fire). Keeping the math pure means that the moment the host
 * starts emitting real per-run cost, we only change the thin parsing layer, not
 * the tested accounting core.
 */

/**
 * A single, already-normalised spend observation extracted from a host event.
 *
 * Every host event we care about (a budget incident, a finished run, or a
 * future first-class cost event) is reduced to one of these before it touches
 * the ledger. That uniformity is what lets one `applySpend()` function handle
 * every source.
 */
export interface SpendObservation {
  /** Company the spend belongs to. Always present — Paperclip events are company-scoped. */
  companyId: string;
  /**
   * Agent that incurred the spend, when known. Budget incidents scoped to an
   * agent and finished-run events both carry this; company/project-scoped
   * incidents may not, in which case attribution falls back to scope buckets.
   */
  agentId?: string;
  /** Issue/task the spend is attributable to, when the event exposes it. */
  issueId?: string;
  /**
   * Reported spend in US dollars for this observation. May be `undefined` when
   * the host event carries no monetary figure (e.g. a bare finished-run event
   * in the current build). Undefined contributes 0 dollars but still counts as
   * a run for run-count tracking.
   */
  costUsd?: number;
  /** Prompt/input tokens, when reported. */
  promptTokens?: number;
  /** Completion/output tokens, when reported. */
  completionTokens?: number;
  /** ISO-8601 timestamp the spend occurred at. Drives the per-day rolling bucket. */
  occurredAt: string;
  /** Whether this observation represents a completed agent run (for run counts). */
  isRun: boolean;
}

/**
 * Running totals for a single attribution bucket (one agent, one issue, or one
 * day). Stored verbatim in plugin state under the relevant scope key.
 *
 * `schemaVersion` is embedded so future format changes can be migrated on read
 * (the host does not migrate plugin state for us — see PLUGIN_SPEC §25.2).
 */
export interface SpendTotals {
  /** State-shape version, so we can evolve the stored JSON safely. */
  schemaVersion: 1;
  /** Cumulative dollars attributed to this bucket. */
  costUsd: number;
  /** Cumulative prompt tokens. */
  promptTokens: number;
  /** Cumulative completion tokens. */
  completionTokens: number;
  /** Number of completed runs counted into this bucket. */
  runCount: number;
  /** ISO-8601 timestamp this bucket was last updated. */
  updatedAt: string;
}

/**
 * Operator-configured ceilings, in US dollars. Any field left undefined means
 * "no ceiling of that kind" — spend-guard simply tracks and never alerts on it.
 *
 * These come straight from the plugin's `instanceConfigSchema` after the host
 * has validated them, so the worker can trust the types.
 */
export interface BudgetConfig {
  /** Spend ceiling per agent (lifetime, since install/last reset). */
  perAgentUsd?: number;
  /** Spend ceiling per issue/task. */
  perIssueUsd?: number;
  /** Spend ceiling per UTC day, rolling. */
  perDayUsd?: number;
  /**
   * Fraction of a ceiling at which a "warn" alert fires (e.g. 0.8 = 80%).
   * Defaults to 0.8 when omitted. Clamped to (0, 1] by `normalizeBudgetConfig`.
   */
  warnRatio?: number;
  /**
   * Opt-in enforcement. When true AND a per-agent ceiling is crossed at 100%,
   * spend-guard will call `ctx.agents.pause()`. Default false (alert-only).
   * Only meaningful for the per-agent ceiling because pausing is an agent-level
   * action — there is no "pause an issue" or "pause a day" in the host.
   */
  pauseAgentOnCeiling?: boolean;
}

/** The severity levels spend-guard can raise for a bucket. */
export type AlertLevel = "ok" | "warn" | "alert";

/**
 * The result of evaluating one bucket's totals against one ceiling.
 */
export interface BudgetEvaluation {
  /** Which kind of ceiling this evaluation is about. */
  scope: "agent" | "issue" | "day";
  /** The identifier of the bucket (agentId, issueId, or YYYY-MM-DD day key). */
  scopeId: string;
  /** Dollars spent in this bucket so far. */
  spentUsd: number;
  /** The configured ceiling in dollars (the limit being evaluated). */
  limitUsd: number;
  /** spentUsd / limitUsd, for display and threshold comparisons. */
  ratio: number;
  /** Computed severity given the spend, limit and warn ratio. */
  level: AlertLevel;
}
