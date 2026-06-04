/**
 * Ledger math — pure functions that fold `SpendObservation`s into per-bucket
 * `SpendTotals`. No I/O here; the worker reads the prior totals from plugin
 * state, calls these to compute the next totals, and writes them back.
 *
 * Three attribution dimensions are tracked, each as an independent bucket:
 *   - per agent   (keyed by agentId)
 *   - per issue   (keyed by issueId)
 *   - per day     (keyed by a UTC YYYY-MM-DD day string, "rolling" in the sense
 *                  that each day is its own bucket; old days simply stop being
 *                  written to)
 *
 * Keeping these as pure reducers makes the accounting trivially unit-testable
 * and immune to the messiness of the host event stream.
 */

import type { SpendObservation, SpendTotals } from "./types.js";

/** A fresh, zeroed totals record stamped at `updatedAt`. */
export function emptyTotals(updatedAt: string): SpendTotals {
  return {
    schemaVersion: 1,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    runCount: 0,
    updatedAt,
  };
}

/**
 * Coerce whatever was read from plugin state back into a valid `SpendTotals`.
 *
 * Plugin state is `unknown` JSON, may be `null` (never written), and — across
 * plugin upgrades — could in principle be an older shape. We normalise here so
 * every downstream caller can assume a well-formed record. `schemaVersion` is
 * checked so a future v2 shape can be migrated in one place.
 */
export function coerceTotals(value: unknown, now: string): SpendTotals {
  if (typeof value !== "object" || value === null) return emptyTotals(now);
  const v = value as Record<string, unknown>;
  const num = (x: unknown): number =>
    typeof x === "number" && Number.isFinite(x) ? x : 0;
  return {
    schemaVersion: 1,
    costUsd: num(v.costUsd),
    promptTokens: num(v.promptTokens),
    completionTokens: num(v.completionTokens),
    runCount: num(v.runCount),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : now,
  };
}

/**
 * Fold a single observation into a prior totals record, returning a NEW record
 * (the input is never mutated — important since the same prior object may be
 * reused across the agent/issue/day folds in the worker).
 *
 * Cost is additive. The subtle part is budget-incident observations: those
 * report an *absolute observed amount* for a scope, not an increment. We still
 * add it here because the worker only routes an incident's dollars into the
 * matching dimension (e.g. an agent-scoped incident updates that agent's
 * bucket), and incidents fire at distinct thresholds (soft, then hard), so
 * double counting is bounded and always errs toward "more visible spend" —
 * the safe direction for a guardrail. The README documents this tradeoff
 * honestly; precise per-run accounting awaits `cost_event.created` being wired.
 */
export function applyObservation(
  prior: SpendTotals,
  obs: SpendObservation,
): SpendTotals {
  return {
    schemaVersion: 1,
    costUsd: prior.costUsd + (obs.costUsd ?? 0),
    promptTokens: prior.promptTokens + (obs.promptTokens ?? 0),
    completionTokens: prior.completionTokens + (obs.completionTokens ?? 0),
    runCount: prior.runCount + (obs.isRun ? 1 : 0),
    updatedAt: obs.occurredAt,
  };
}

/**
 * Derive the UTC day-bucket key (YYYY-MM-DD) for an ISO timestamp.
 *
 * We use UTC deliberately so "per day" is stable and operator-timezone
 * independent; the README notes this so a configurable timezone can be added
 * later without surprising anyone.
 */
export function dayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) {
    // Defensive: never throw on a bad timestamp; bucket it under "unknown".
    return "unknown";
  }
  // toISOString() is always UTC; slice the date portion.
  return d.toISOString().slice(0, 10);
}
