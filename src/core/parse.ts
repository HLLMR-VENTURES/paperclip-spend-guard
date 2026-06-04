/**
 * Event parsing — turn a raw Paperclip plugin event payload into a normalised
 * `SpendObservation` (or `null` when the event carries nothing we can attribute).
 *
 * This is the single layer that knows the *shape* of host events, and it is
 * where the realities of the current Paperclip build are encoded. See the
 * README "Contract notes" for the full investigation; the short version:
 *
 *   - `agent.run.finished` IS emitted by the host (heartbeat service), but its
 *     payload contains NO cost figure — only run/agent/issue identifiers. We
 *     still parse it so we can count runs and attribute per-issue activity.
 *
 *   - `budget.incident.opened` / `budget.incident.resolved` ARE emitted (mapped
 *     from the `budget.soft_threshold_crossed` / `budget.hard_threshold_crossed`
 *     / `budget.incident_resolved` activity actions). Their payload carries
 *     `amountObserved` and `amountLimit` in *billed cents*, plus `scopeType`
 *     and `scopeId`. This is the only real monetary signal a plugin can see in
 *     this build, so it is our primary cost input.
 *
 *   - `cost_event.created` is declared in PLUGIN_EVENT_TYPES but the host never
 *     fires it in this build (the `cost.reported` activity action is not mapped
 *     to it). We parse it anyway and prefer it when present, so spend-guard is
 *     forward-compatible: the day the host wires it, per-run dollar attribution
 *     "just works" with no code change here.
 *
 * Every field is read defensively because plugin event payloads are typed as
 * `unknown` at the boundary and details objects are spread in by the host.
 */

import type { SpendObservation } from "./types.js";

/** Read a finite number from an unknown value, or undefined. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Some host payloads stringify numbers (details JSON round-trips); accept those.
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Read a non-empty string from an unknown value, or undefined. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The subset of a Paperclip `PluginEvent` that the parser reads. We model it
 * locally (rather than importing the SDK type) so the core stays dependency
 * free and testable. The worker passes the real event straight in — the shapes
 * are structurally compatible.
 */
export interface RawPluginEvent {
  eventType: string;
  occurredAt?: string;
  companyId: string;
  /** Present on agent-actor events (e.g. finished runs). */
  actorId?: string;
  actorType?: string;
  entityId?: string;
  entityType?: string;
  /** The host spreads activity `details` plus `{ agentId, runId }` into here. */
  payload?: unknown;
}

/**
 * Convert billed *cents* (how budget incidents report money) to dollars.
 * Exported because the per-day/issue/agent display also needs consistent
 * rounding behaviour and tests assert on it.
 */
export function centsToUsd(cents: number | undefined): number | undefined {
  if (cents === undefined) return undefined;
  // Round to the cent to avoid float dust like 12.340000000000001.
  return Math.round(cents) / 100;
}

/**
 * Parse one host event into a `SpendObservation`, or `null` if it is not a
 * spend-relevant event (or is malformed).
 *
 * The returned observation always carries `companyId` and `occurredAt`; the
 * monetary/agent/issue fields are filled only when the specific event type
 * exposes them.
 */
export function parseSpendEvent(event: RawPluginEvent): SpendObservation | null {
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : {};

  // A single occurredAt for the whole observation; default to now if the host
  // omitted it (it never should, but the core must not throw on bad input).
  const occurredAt = asString(event.occurredAt) ?? new Date().toISOString();
  const companyId = asString(event.companyId);
  if (!companyId) return null; // Company scope is mandatory; nothing to attribute without it.

  switch (event.eventType) {
    // ---------------------------------------------------------------------
    // Future-facing: first-class per-run cost. Not emitted in this build, but
    // parsed so spend-guard is ready the moment the host wires it.
    // ---------------------------------------------------------------------
    case "cost_event.created": {
      // Cost events may report dollars directly (`costUsd`) or cents
      // (`costCents`, as the cost.reported activity detail does today).
      const costUsd =
        asNumber(payload.costUsd) ?? centsToUsd(asNumber(payload.costCents));
      return {
        companyId,
        agentId: asString(payload.agentId) ?? asString(event.actorId),
        issueId: asString(payload.issueId),
        costUsd,
        promptTokens: asNumber(payload.promptTokens),
        completionTokens: asNumber(payload.completionTokens),
        occurredAt,
        // A cost event is not itself a "run"; it is a billing line.
        isRun: false,
      };
    }

    // ---------------------------------------------------------------------
    // Real signal #1: a completed agent run. No cost in the payload (verified
    // against the heartbeat service), so this contributes a run count and
    // per-issue activity attribution but $0 of cost.
    // ---------------------------------------------------------------------
    case "agent.run.finished": {
      return {
        companyId,
        agentId: asString(payload.agentId) ?? asString(event.actorId),
        issueId: asString(payload.issueId),
        costUsd: undefined,
        occurredAt,
        isRun: true,
      };
    }

    // ---------------------------------------------------------------------
    // Real signal #2: a budget incident. The host's own budget engine computed
    // `amountObserved` (billed cents) for a scope; we treat that observed
    // amount as the authoritative spend snapshot for that scope. This is the
    // primary dollar signal in the current build.
    // ---------------------------------------------------------------------
    case "budget.incident.opened":
    case "budget.incident.resolved": {
      const observedUsd = centsToUsd(asNumber(payload.amountObserved));
      const scopeType = asString(payload.scopeType); // "company" | "agent" | "project"
      const scopeId = asString(payload.scopeId);
      return {
        companyId,
        // Map the incident's scope onto our attribution dimensions. A project
        // incident maps to neither agent nor issue here (we don't track
        // project buckets in v0.1.0), but the observation still records the
        // company-level spend snapshot.
        agentId: scopeType === "agent" ? scopeId : asString(payload.agentId),
        issueId: asString(payload.issueId),
        costUsd: observedUsd,
        occurredAt,
        isRun: false,
      };
    }

    default:
      return null;
  }
}
