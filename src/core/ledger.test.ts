/**
 * Unit tests for the ledger reducers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyTotals,
  coerceTotals,
  applyObservation,
  dayKey,
} from "./ledger.js";
import type { SpendObservation } from "./types.js";

const NOW = "2026-06-04T00:00:00.000Z";

test("emptyTotals is zeroed and stamped", () => {
  const t = emptyTotals(NOW);
  assert.deepEqual(t, {
    schemaVersion: 1,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    runCount: 0,
    updatedAt: NOW,
  });
});

test("coerceTotals repairs null and partial state", () => {
  assert.deepEqual(coerceTotals(null, NOW), emptyTotals(NOW));
  const partial = coerceTotals({ costUsd: 5, runCount: 2 }, NOW);
  assert.equal(partial.costUsd, 5);
  assert.equal(partial.runCount, 2);
  assert.equal(partial.promptTokens, 0);
  assert.equal(partial.schemaVersion, 1);
});

test("coerceTotals ignores non-numeric junk", () => {
  const t = coerceTotals({ costUsd: "lots", runCount: null }, NOW);
  assert.equal(t.costUsd, 0);
  assert.equal(t.runCount, 0);
});

test("applyObservation adds cost and tokens and increments runs", () => {
  const obs: SpendObservation = {
    companyId: "co",
    costUsd: 1.25,
    promptTokens: 100,
    completionTokens: 50,
    occurredAt: "2026-06-04T01:00:00.000Z",
    isRun: true,
  };
  const next = applyObservation(emptyTotals(NOW), obs);
  assert.equal(next.costUsd, 1.25);
  assert.equal(next.promptTokens, 100);
  assert.equal(next.completionTokens, 50);
  assert.equal(next.runCount, 1);
  assert.equal(next.updatedAt, obs.occurredAt);
});

test("applyObservation treats missing cost as 0 but still counts the run", () => {
  const obs: SpendObservation = {
    companyId: "co",
    occurredAt: NOW,
    isRun: true,
  };
  const next = applyObservation(emptyTotals(NOW), obs);
  assert.equal(next.costUsd, 0);
  assert.equal(next.runCount, 1);
});

test("applyObservation does not mutate the prior record", () => {
  const prior = emptyTotals(NOW);
  applyObservation(prior, { companyId: "co", costUsd: 9, occurredAt: NOW, isRun: false });
  assert.equal(prior.costUsd, 0, "prior must be untouched (shared across folds)");
});

test("dayKey produces UTC YYYY-MM-DD and tolerates bad input", () => {
  assert.equal(dayKey("2026-06-04T23:59:59.000Z"), "2026-06-04");
  assert.equal(dayKey("2026-06-04T00:00:00.000+05:00"), "2026-06-03"); // UTC shift
  assert.equal(dayKey("garbage"), "unknown");
});
