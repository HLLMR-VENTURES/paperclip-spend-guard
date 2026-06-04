/**
 * Unit tests for event parsing. These pin the exact shapes the current
 * Paperclip build emits (verified by reading the host's compiled services),
 * plus the forward-compatible cost_event path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpendEvent, centsToUsd, type RawPluginEvent } from "./parse.js";

test("centsToUsd converts and rounds billed cents to dollars", () => {
  assert.equal(centsToUsd(1234), 12.34);
  assert.equal(centsToUsd(0), 0);
  assert.equal(centsToUsd(undefined), undefined);
  // No float dust.
  assert.equal(centsToUsd(1234.0000001), 12.34);
});

test("agent.run.finished parses as a run with no cost", () => {
  const event: RawPluginEvent = {
    eventType: "agent.run.finished",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    actorId: "agent-7",
    payload: { runId: "run-9", agentId: "agent-7", issueId: "iss-3", status: "succeeded" },
  };
  const obs = parseSpendEvent(event);
  assert.ok(obs);
  assert.equal(obs.isRun, true);
  assert.equal(obs.costUsd, undefined); // verified: run-finished payload has no cost
  assert.equal(obs.agentId, "agent-7");
  assert.equal(obs.issueId, "iss-3");
  assert.equal(obs.companyId, "co-1");
});

test("agent.run.finished falls back to actorId when payload.agentId missing", () => {
  const obs = parseSpendEvent({
    eventType: "agent.run.finished",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    actorId: "agent-actor",
    payload: { runId: "run-9", status: "succeeded" },
  });
  assert.ok(obs);
  assert.equal(obs.agentId, "agent-actor");
});

test("budget.incident.opened parses observed cents into dollars on the agent bucket", () => {
  const obs = parseSpendEvent({
    eventType: "budget.incident.opened",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    payload: { scopeType: "agent", scopeId: "agent-22", amountObserved: 5000, amountLimit: 6000 },
  });
  assert.ok(obs);
  assert.equal(obs.costUsd, 50); // 5000 cents -> $50
  assert.equal(obs.agentId, "agent-22"); // agent-scoped incident maps to the agent dimension
  assert.equal(obs.isRun, false);
});

test("budget.incident.resolved is also parsed (same shape)", () => {
  const obs = parseSpendEvent({
    eventType: "budget.incident.resolved",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    payload: { scopeType: "company", scopeId: "co-1", amountObserved: 12345 },
  });
  assert.ok(obs);
  assert.equal(obs.costUsd, 123.45);
  // company-scoped incident does not map to an agent bucket
  assert.equal(obs.agentId, undefined);
});

test("cost_event.created prefers costUsd, falls back to costCents (forward-compatible)", () => {
  const direct = parseSpendEvent({
    eventType: "cost_event.created",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    payload: { costUsd: 1.5, agentId: "a1", issueId: "i1", promptTokens: 10, completionTokens: 20 },
  });
  assert.ok(direct);
  assert.equal(direct.costUsd, 1.5);
  assert.equal(direct.promptTokens, 10);
  assert.equal(direct.completionTokens, 20);
  assert.equal(direct.isRun, false);

  const viaCents = parseSpendEvent({
    eventType: "cost_event.created",
    occurredAt: "2026-06-04T12:00:00.000Z",
    companyId: "co-1",
    payload: { costCents: 250, model: "x" },
  });
  assert.ok(viaCents);
  assert.equal(viaCents.costUsd, 2.5);
});

test("unrelated events and missing company return null", () => {
  assert.equal(
    parseSpendEvent({ eventType: "issue.created", occurredAt: "t", companyId: "co-1", payload: {} }),
    null,
  );
  assert.equal(
    parseSpendEvent({ eventType: "agent.run.finished", occurredAt: "t", companyId: "", payload: {} }),
    null,
  );
});

test("malformed payloads do not throw and default occurredAt", () => {
  const obs = parseSpendEvent({
    eventType: "agent.run.finished",
    companyId: "co-1",
    payload: "not-an-object" as unknown,
  });
  assert.ok(obs);
  assert.equal(typeof obs.occurredAt, "string");
});
