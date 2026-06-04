/**
 * Budget evaluation — pure functions that compare spend against ceilings and
 * decide an alert level. No I/O, no SDK; the worker supplies the numbers.
 */

import type {
  AlertLevel,
  BudgetConfig,
  BudgetEvaluation,
} from "./types.js";

/** The warn ratio used when the operator does not configure one. */
export const DEFAULT_WARN_RATIO = 0.8;

/**
 * Sanitise operator config into a predictable shape.
 *
 * The host validates types against the JSON schema, but it does not enforce
 * our semantic rules (positive ceilings, warn ratio in (0, 1]). Doing it here
 * keeps every consumer honest and gives tests one place to pin behaviour.
 */
export function normalizeBudgetConfig(config: BudgetConfig): BudgetConfig {
  const positive = (n: number | undefined): number | undefined =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;

  // Clamp warn ratio into (0, 1]; fall back to the default for nonsense input.
  let warnRatio = config.warnRatio;
  if (
    typeof warnRatio !== "number" ||
    !Number.isFinite(warnRatio) ||
    warnRatio <= 0 ||
    warnRatio > 1
  ) {
    warnRatio = DEFAULT_WARN_RATIO;
  }

  return {
    perAgentUsd: positive(config.perAgentUsd),
    perIssueUsd: positive(config.perIssueUsd),
    perDayUsd: positive(config.perDayUsd),
    warnRatio,
    // Enforcement only matters when explicitly true; coerce anything else off.
    pauseAgentOnCeiling: config.pauseAgentOnCeiling === true,
  };
}

/**
 * Decide the alert level for a spend/limit pair.
 *
 *   spent >= limit            -> "alert" (ceiling reached or exceeded)
 *   spent >= limit*warnRatio  -> "warn"
 *   otherwise                 -> "ok"
 *
 * A non-positive limit means "no ceiling configured" and always returns "ok".
 */
export function levelFor(
  spentUsd: number,
  limitUsd: number,
  warnRatio: number = DEFAULT_WARN_RATIO,
): AlertLevel {
  if (!(limitUsd > 0)) return "ok";
  if (spentUsd >= limitUsd) return "alert";
  if (spentUsd >= limitUsd * warnRatio) return "warn";
  return "ok";
}

/**
 * Evaluate one bucket against one ceiling, producing a full `BudgetEvaluation`
 * (or `null` when no ceiling of that kind is configured — nothing to evaluate).
 */
export function evaluateBucket(
  scope: BudgetEvaluation["scope"],
  scopeId: string,
  spentUsd: number,
  limitUsd: number | undefined,
  warnRatio: number = DEFAULT_WARN_RATIO,
): BudgetEvaluation | null {
  if (!(typeof limitUsd === "number" && limitUsd > 0)) return null;
  return {
    scope,
    scopeId,
    spentUsd,
    limitUsd,
    ratio: limitUsd > 0 ? spentUsd / limitUsd : 0,
    level: levelFor(spentUsd, limitUsd, warnRatio),
  };
}

/**
 * Decide whether an alert level transition is worth emitting an event for.
 *
 * Budget incidents and finished runs can arrive repeatedly while a bucket is
 * already over a threshold; we only want to emit when the level actually
 * *increases* (ok -> warn, warn -> alert, ok -> alert). This keeps the plugin
 * idempotent-friendly (events are at-least-once per PLUGIN_SPEC §13.5) and
 * stops alert spam. The worker persists the last-emitted level per bucket and
 * passes it here.
 */
export function shouldEmit(previous: AlertLevel, next: AlertLevel): boolean {
  const rank: Record<AlertLevel, number> = { ok: 0, warn: 1, alert: 2 };
  return rank[next] > rank[previous];
}
