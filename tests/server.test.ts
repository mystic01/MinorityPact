import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { parseConfig, modelForSeat } from '../src/domain/config.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { createApp } from '../src/server/app.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { ProviderDecisionError } from '../src/controllers/openrouter.ts';
import type { DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
const config = () => parseConfig(JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8')));

test('runtime output floor raises saved allowance without changing models, reasoning or persisted config', () => {
  const c = config(); c.llm.parameters.max_tokens = 4096;
  const original = structuredClone(c);
  const store = new SqliteEventStore(':memory:');
  try {
    store.createSession('limits', c);
    const saved = store.getConfig('limits');
    const resolved = modelForSeat(saved, 'E', 8192);
    assert.equal(resolved.parameters.max_tokens, 8192);
    assert.equal(resolved.model, c.seatModels!.E!.model);
    assert.deepEqual(resolved.parameters.reasoning, { effort: 'low' });
    assert.equal(modelForSeat(saved, 'E').parameters.max_tokens, 4096);
    assert.equal(modelForSeat(saved, 'E', 2048).parameters.max_tokens, 4096);
    assert.deepEqual(modelForSeat(saved, 'B', 8192).parameters.reasoning, { max_tokens: 1024 });
    assert.deepEqual(saved, original);
    assert.deepEqual(store.getConfig('limits'), original);
    assert.throws(() => modelForSeat(saved, 'E', -1));
  } finally { store.close(); }
});
test('five seat models are distinct, configurable, and frozen per saved session', () => {
  const c = config(); assert.equal(new Set(c.players.map(id => modelForSeat(c, id).model)).size, 5);
  const store = new SqliteEventStore(':memory:');
  try { store.createSession('s', c); c.seatModels!.A!.model = 'changed'; assert.notEqual(modelForSeat(store.getConfig('s'), 'A').model, 'changed'); }
  finally { store.close(); }
});
test('GLM uses low reasoning by default while explicit user reasoning is preserved', () => {
  const c = config();
  assert.deepEqual(modelForSeat(c, 'E').parameters.reasoning, { effort: 'low' });
  c.llm.parameters.reasoning = { effort: 'high' };
  assert.deepEqual(modelForSeat(c, 'E').parameters.reasoning, { effort: 'high' });
  assert.equal(modelForSeat(c, 'E').parameters.max_tokens, 8192);
});

test('paused HTTP/SSE reports the unresolved rate limit instead of a resolved peers later rejection', async () => {
  const store = new SqliteEventStore(':memory:'); const c = config(); store.createSession('limited', c);
  const controllers = Object.fromEntries(c.players.map(id => [id, { decide: async (): Promise<DecisionResult> => {
    if (id === 'D') throw new ProviderDecisionError('http_429', false);
    return { actions: [], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'PRIVATE_PLAN', whyThisAction: 'wait', predictedOutcome: 'unknown', observedEventIds: [] } };
  } }]));
  await assert.rejects(new DecisionCoordinator(store, 'limited', controllers).step(async () => {}));
  const cp = (await store.loadCheckpoint('limited'))!;
  const peer = cp.pendingDecisions.find(p => p.snapshot.input.agentId === 'A')!;
  store.recordAudit('limited', peer.snapshot.snapshotId, { kind: 'decision_rejected', code: 'invalid_response', reason: 'PRIVATE_PROVIDER_DETAIL' });
  store.setStatus('limited', 'paused_error');
  const app = createApp({ store, config: c }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const view = await (await fetch(`${root}/api/sessions/limited`)).text();
    assert.ok(view.includes('HTTP 429')); assert.ok(!view.includes('PRIVATE_'));
    const abort = new AbortController();
    const response = await fetch(`${root}/api/sessions/limited/stream`, { signal: abort.signal });
    const chunk = new TextDecoder().decode((await response.body!.getReader().read()).value); abort.abort();
    assert.ok(chunk.includes('HTTP 429')); assert.ok(!chunk.includes('PRIVATE_'));
  } finally { app.stop(); store.close(); }
});

test('saved Qwen sessions resolve a numeric reasoning budget without mutating config or other seats', () => {
  const c = config(); c.llm.parameters.max_tokens = 4096; const original = structuredClone(c);
  const store = new SqliteEventStore(':memory:');
  try {
    store.createSession('qwen', c);
    const saved = store.getConfig('qwen');
    assert.deepEqual(modelForSeat(saved, 'B').parameters.reasoning, { max_tokens: 1024 });
    assert.equal(modelForSeat(saved, 'B').parameters.max_tokens, 4096);
    assert.equal(modelForSeat(saved, 'D').parameters.reasoning, undefined);
    assert.deepEqual(saved, original);
    assert.deepEqual(store.getConfig('qwen'), original);
    for (const reasoning of [{ effort: 'high' }, { max_tokens: 1024 }]) {
      saved.llm.parameters.reasoning = reasoning;
      assert.deepEqual(modelForSeat(saved, 'B').parameters.reasoning, reasoning);
    }
  } finally { store.close(); }
});

test('Qwen defaults disable optional reasoning when output budget cannot fit 1024 thinking tokens', () => {
  const c = config(); c.llm.parameters.max_tokens = 512;
  assert.deepEqual(modelForSeat(c, 'B').parameters.reasoning, { effort: 'none' });
});
test('local HTTP operations enforce origin/token; public snapshots/SSE do not disclose secrets', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  await store.commitBatch({ sessionId: 's', batchId: 'b', expectedVersion: 0, checkpoint: { logicalTimeMs: 0, subscriptions: {}, pendingActions: [], pendingDecisions: [] }, events: [{ eventId: 'e1', sessionId: 's', round: 1, phase: 'negotiation', schemaVersion: 1, batchId: 'b', commitSeq: 1, logicalTimeMs: 0, data: { type: 'private_message_sent', actorId: 'A', recipientId: 'B', body: 'SECRET_SENTINEL', logicalTimeMs: 0, batchId: 'b' } }] });
  const app = createApp({ store, config: config(), apiKey: 'KEY_SENTINEL' }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${root}/api/bootstrap`, { headers: { Origin: 'https://evil.test' } })).status, 403);
    const bootstrap = await (await fetch(`${root}/api/bootstrap`)).json() as { token: string };
    assert.ok(!JSON.stringify(bootstrap).includes('KEY_SENTINEL'));
    assert.equal((await fetch(`${root}/api/sessions`, { method: 'POST' })).status, 403);
    const created = await fetch(`${root}/api/sessions`, { method: 'POST', headers: { 'X-Operation-Token': bootstrap.token }, body: JSON.stringify(config()) }); assert.equal(created.status, 201);
    for (const path of ['/api/sessions/s', '/api/sessions/s/events?after=0', '/api/sessions/s?role=admin&agentId=A']) assert.ok(!(await (await fetch(root + path)).text()).includes('SECRET_SENTINEL'));
    assert.equal((await fetch(`${root}/api/sessions/s/replay?view=omniscient`)).status, 400);
    const controller = new AbortController();
    const stream = await fetch(`${root}/api/sessions/s/stream?view=omniscient`, { signal: controller.signal });
    const reader = stream.body!.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes('id: 1')); assert.ok(!first.includes('SECRET_SENTINEL')); controller.abort();
    const reconnect = new AbortController(); const second = await fetch(`${root}/api/sessions/s/stream`, { headers: { 'Last-Event-ID': '1' }, signal: reconnect.signal });
    const chunk = new TextDecoder().decode((await second.body!.getReader().read()).value); assert.ok(chunk.includes('"events":[]')); reconnect.abort();
  } finally { app.stop(); store.close(); }
});
test('HTTP starts scripted controllers, completes, unlocks exact replay and keeps live stream public', async () => {
  const store = new SqliteEventStore(':memory:'); store.createSession('s', config());
  const app = createApp({ store, config: config(), pace: async () => {}, controllers: c => Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput): Promise<DecisionResult> => ({
    actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: i.agentId === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'PRIVATE_PLAN', whyThisAction: 'observe', predictedOutcome: 'unknown', observedEventIds: [] },
  }) }])) }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const { token } = await (await fetch(`${root}/api/bootstrap`)).json() as { token: string };
    assert.equal((await fetch(`${root}/api/sessions/s/start`, { method: 'POST', headers: { 'X-Operation-Token': token } })).status, 200);
    let done = false;
    for (let n = 0; n < 100; n++) {
      const live = await (await fetch(`${root}/api/sessions/s`)).json() as { state: { phase: string } };
      assert.ok(!JSON.stringify(live).includes('PRIVATE_PLAN'));
      if (live.state.phase === 'completed') { done = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.ok(done);
    const full = await (await fetch(`${root}/api/sessions/s/replay?view=omniscient`)).text(); assert.ok(full.includes('PRIVATE_PLAN'));
    const early = await (await fetch(`${root}/api/sessions/s/replay?view=omniscient&through=0`)).json() as { state: { standings: { score: number }[] }; events: unknown[] };
    assert.equal(early.events.length, 0); assert.ok(early.state.standings.every(s => s.score === 0));
  } finally { app.stop(); store.close(); }
});
