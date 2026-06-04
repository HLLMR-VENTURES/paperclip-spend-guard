/**
 * Unit tests for budget evaluation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBudgetConfig,
  levelFor,
  evaluateBucket,
  shouldEmit,
  DEFAULT_WARN_RATIO,
} from "./budget.js";

test("normalizeBudgetConfig drops non-positive ceilings and defaults warn ratio", () => {
  const c = normalizeBudgetConfig({
    perAgentUsd: 100,
    perIssueUsd: 0,
    perDayUsd: -5,
  });
  assert.equal(c.perAgentUsd, 100);
  assert.equal(c.perIssueUsd, undefined);
  assert.equal(c.perDayUsd, undefined);
  assert.equal(c.warnRatio, DEFAULT_WARN_RATIO);
  assert.equal(c.pauseAgentOnCeiling, false);
});

test("normalizeBudgetConfig clamps an out-of-range warn ratio to the default", () => {
  assert.equal(normalizeBudgetConfig({ warnRatio: 0 }).warnRatio, DEFAULT_WARN_RATIO);
  assert.equal(normalizeBudgetConfig({ warnRatio: 1.5 }).warnRatio, DEFAULT_WARN_RATIO);
  assert.equal(normalizeBudgetConfig({ warnRatio: 0.5 }).warnRatio, 0.5);
});

test("normalizeBudgetConfig only enables enforcement on explicit true", () => {
  assert.equal(normalizeBudgetConfig({ pauseAgentOnCeiling: true }).pauseAgentOnCeiling, true);
  assert.equal(
    normalizeBudgetConfig({ pauseAgentOnCeiling: "yes" as unknown as boolean }).pauseAgentOnCeiling,
    false,
  );
});

test("levelFor computes ok/warn/alert against the warn ratio", () => {
  assert.equal(levelFor(50, 100, 0.8), "ok");
  assert.equal(levelFor(80, 100, 0.8), "warn");
  assert.equal(levelFor(99.99, 100, 0.8), "warn");
  assert.equal(levelFor(100, 100, 0.8), "alert");
  assert.equal(levelFor(150, 100, 0.8), "alert");
});

test("levelFor treats a non-positive limit as no-ceiling (always ok)", () => {
  assert.equal(levelFor(1000, 0, 0.8), "ok");
});

test("evaluateBucket returns null when no ceiling is configured", () => {
  assert.equal(evaluateBucket("agent", "a1", 10, undefined), null);
  assert.equal(evaluateBucket("agent", "a1", 10, 0), null);
});

test("evaluateBucket fills ratio and level", () => {
  const e = evaluateBucket("day", "2026-06-04", 90, 100, 0.8);
  assert.ok(e);
  assert.equal(e.scope, "day");
  assert.equal(e.scopeId, "2026-06-04");
  assert.equal(e.ratio, 0.9);
  assert.equal(e.level, "warn");
});

test("shouldEmit only fires on increasing severity", () => {
  assert.equal(shouldEmit("ok", "warn"), true);
  assert.equal(shouldEmit("warn", "alert"), true);
  assert.equal(shouldEmit("ok", "alert"), true);
  assert.equal(shouldEmit("warn", "warn"), false);
  assert.equal(shouldEmit("alert", "warn"), false); // de-escalation is not an alert
  assert.equal(shouldEmit("alert", "alert"), false);
});
