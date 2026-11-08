import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { GameClock } from '../src/application/clock.ts';
import { parseConfig } from '../src/domain/config.ts';
import type { AgentController, DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
import { ProviderDecisionError } from '../src/controllers/openrouter.ts';
const config = (mode: 'fixed_5s' | 'fixed_15s' = 'fixed_5s') => parseConfig({ ...JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8')), scheduling: { mode, eventReactionMs: 1000 }, llm: { provider: 'openrouter', model: 'test/model', parameters: {} } });
const result = (i: DecisionInput): DecisionResult => ({ actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: i.agentId === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'observe', whyThisAction: 'wait', predictedOutcome: 'unknown', observedEventIds: [] } });
const pace = async (_: number) => {};
test('clock remains frozen across arbitrary wall time', () => {
  let wall = 0; const c = new GameClock(0, () => wall); wall = 5; assert.equal(c.read(), 5);
  c.pause(); wall = 99999; assert.equal(c.read(), 5); c.resume(); wall += 3; assert.equal(c.read(), 8);
});
for (const failureCode of ['output_token_limit', 'http_429']) test(`${failureCode} stops after one attempt and retains successful peer results`, async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  const calls: Record<string, number> = {};
  const controllers = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => {
    calls[id] = (calls[id] ?? 0) + 1;
    if (id === 'E') throw new ProviderDecisionError(failureCode, false);
    return result(i);
  } }]));
  try {
    await assert.rejects(new DecisionCoordinator(store, 's', controllers).step(pace), /paused_error/);
    assert.equal(calls.E, 1);
    const cp = await store.loadCheckpoint('s');
    assert.equal(cp?.pendingDecisions.filter(p => p.result).length, 4);
    assert.ok(store.readAudit('s').some(a => a.code === failureCode));
  } finally { store.close(); }
});
test('missing goal-change reason pauses without discarding peers; corrected reason resumes original snapshot', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  let repaired = false; const calls: Record<string, number> = {}; const snapshots: string[] = [];
  const controllers = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => {
    calls[id] = (calls[id] ?? 0) + 1; const r = result(i);
    if (id === 'E' && i.logicalTimeMs === 0) r.nextWake.atGameTimeMs = 5000;
    if (id === 'E' && i.logicalTimeMs === 5000) {
      snapshots.push(JSON.stringify(i)); r.strategyNote.goal = '新的目標';
      if (repaired) r.strategyNote.revisionReason = '根據已知局勢調整目標';
    }
    return r;
  } }]));
  try {
    const coordinator = new DecisionCoordinator(store, 's', controllers);
    await coordinator.step(pace);
    await assert.rejects(coordinator.step(pace), /paused_error/);
    assert.ok(store.readAudit('s').some(a => a.reason === 'Goal change needs reason'));
    repaired = true; await new DecisionCoordinator(store, 's', controllers).step(pace);
    assert.equal(new Set(snapshots).size, 1); assert.equal(calls.A, 1);
    const notes = (await store.readEvents('s', 0)).filter(e => e.data.type === 'strategy_note' && e.data.actorId === 'E');
    assert.equal(notes.length, 2);
    assert.equal(store.readCompletedDecisions('s').length, 6);
  } finally { store.close(); }
});
test('future message stays private until aligned execution boundary after coordinator restart', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  const controllers = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => {
    const r = result(i);
    if (id === 'A' && i.logicalTimeMs === 0) r.actions = [{ type: 'send_private_message', actionId: 'later', recipientId: 'B', message: 'FUTURE', scheduledTimeMs: 1 }];
    return r;
  } }]));
  try {
    await new DecisionCoordinator(store, 's', controllers).step(pace);
    assert.ok(!(await store.readEvents('s', 0)).some(e => e.data.type === 'private_message_sent'));
    assert.equal((await store.loadCheckpoint('s'))?.pendingActions[0]?.action.scheduledTimeMs, 5000);
    await new DecisionCoordinator(store, 's', controllers).step(pace);
    const sent = (await store.readEvents('s', 0)).find(e => e.data.type === 'private_message_sent');
    assert.equal(sent?.logicalTimeMs, 5000);
  } finally { store.close(); }
});
test('controller completion order does not change snapshots or events', async () => {
  const run = async (reverse: boolean) => {
    const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
    const inputs: DecisionInput[] = [];
    const controllers = Object.fromEntries(config().players.map((id, n) => [id, { decide: async (i: DecisionInput) => {
      inputs.push(structuredClone(i)); await new Promise(r => setTimeout(r, reverse ? 5 - n : n)); return result(i);
    } }]));
    try { const c = new DecisionCoordinator(store, 's', controllers); await c.step(pace); return { inputs, events: await store.readEvents('s', 0) }; }
    finally { store.close(); }
  };
  assert.deepEqual(await run(false), await run(true));
});
test('failed decisions resume original snapshots without recalling successful peers', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  const counts: Record<string, number> = {}; let fail = true; const snapshots: string[] = [];
  const controllers: Record<string, AgentController> = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => {
    counts[id] = (counts[id] ?? 0) + 1;
    if (id === 'B') { snapshots.push(JSON.stringify(i)); if (fail) throw new Error('offline'); }
    return result(i);
  } }]));
  try {
    await assert.rejects(new DecisionCoordinator(store, 's', controllers).step(pace));
    assert.equal((await store.readEvents('s', 0)).length, 0);
    fail = false; await new DecisionCoordinator(store, 's', controllers).step(pace);
    assert.equal(counts.A, 1); assert.equal(counts.B, 4); assert.equal(new Set(snapshots).size, 1);
    assert.equal(store.readCompletedDecisions('s').length, 5);
  } finally { store.close(); }
});
test('silent agents are not polled each window; scripted ten-round game completes', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config()); let calls = 0;
  const controllers = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => { calls++; return result(i); } }]));
  try {
    const c = new DecisionCoordinator(store, 's', controllers);
    let completed = false;
    for (let step = 0; step < 100; step++) if (await c.step(pace) === 'completed') { completed = true; break; }
    assert.ok(completed); assert.equal(calls, 100);
    assert.equal((await store.readEvents('s', 0)).at(-1)?.data.type, 'game_ended');
  } finally { store.close(); }
});
test('only subscribed recipient wakes in next window', async () => {
  for (const mode of ['fixed_5s', 'fixed_15s'] as const) {
    const store = new SqliteEventStore(':memory:'); store.createSession('s', config(mode));
    const seen: Record<string, DecisionInput[]> = {};
    const controllers = Object.fromEntries(config().players.map(id => [id, { decide: async (i: DecisionInput) => {
      (seen[id] ??= []).push(i); const r = result(i);
      if (i.logicalTimeMs === 0) {
        if (id === 'A') r.actions = [{ type: 'send_private_message', actionId: 'm', recipientId: 'B', message: 'secret', scheduledTimeMs: 0 }];
        if (id === 'B') r.nextWake.onEvents = ['private_message_received'];
      }
      return r;
    } }]));
    try {
      const c = new DecisionCoordinator(store, 's', controllers); await c.step(pace); await c.step(pace);
      assert.equal(seen.A?.length, 1); assert.equal(seen.B?.length, 2); assert.equal(seen.C?.length, 1);
      assert.equal(seen.B?.[1]?.logicalTimeMs, mode === 'fixed_5s' ? 5000 : 15000);
      assert.equal(seen.B?.[0]?.privateMessages.length, 0); assert.equal(seen.B?.[1]?.privateMessages[0]?.body, 'secret');
    } finally { store.close(); }
  }
});
