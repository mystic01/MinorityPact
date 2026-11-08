import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { parseConfig } from '../src/domain/config.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { humanDecision } from '../src/application/human.ts';
import { createApp } from '../src/server/app.ts';
import type { DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
const config = () => parseConfig({ ...JSON.parse(readFileSync('configs/experimental.json', 'utf8')), humanSeat: 'A', rounds: 5 });
const answer = (i: DecisionInput): DecisionResult => ({ actions: i.phase === 'commit'
  ? [{ type: 'vote', actionId: 'v', color: 'blue', scheduledTimeMs: i.logicalTimeMs }]
  : [{ type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: i.logicalTimeMs }, ...(i.round === 1 && i.logicalTimeMs === 0 && i.agentId === 'B' ? [
    { type: 'send_private_message' as const, actionId: 'p', recipientId: 'A', message: 'FOR_YOU', scheduledTimeMs: 0 },
    { type: 'send_private_message' as const, actionId: 'q', recipientId: 'C', message: 'OTHER_SECRET', scheduledTimeMs: 0 },
    { type: 'send_public_message' as const, actionId: 'm', message: 'BATCH_PUBLIC', scheduledTimeMs: 0 },
  ] : [])], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'PRIVATE_PLAN', whyThisAction: 'test', predictedOutcome: 'unknown', observedEventIds: [] } });

test('human HTTP mode preserves simultaneous privacy, ten windows, locked submission and secret vote', async () => {
  const c = config(), store = new SqliteEventStore(':memory:'); store.createSession('h', c);
  const inputs: DecisionInput[] = [];
  const app = createApp({ store, config: c, pace: async () => {}, controllers: () => Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput) => { assert.notEqual(i.agentId, 'A'); inputs.push(i); return answer(i); } }])) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const { token } = await (await fetch(root + '/api/bootstrap')).json() as { token: string };
  const get = async (path: string) => (await fetch(root + path, { headers: { 'X-Operation-Token': token } })).json() as Promise<any>;
  const post = (action: string, value = {}) => fetch(root + '/api/sessions/h/' + action, { method: 'POST', headers: { 'X-Operation-Token': token }, body: JSON.stringify(value) });
  async function wait() {
    for (let n = 0; n < 200; n++) {
      const v = await get('/api/sessions/h');
      if (['waiting_human', 'completed', 'paused_error'].includes(v.status)) { assert.notEqual(v.status, 'paused_error'); return v; }
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('Did not settle');
  }
  try {
    assert.equal((await fetch(root + '/api/sessions/h/player')).status, 403);
    assert.equal((await post('start')).status, 200); await wait();
    assert.equal(inputs.length, 4);
    const initial = await get('/api/sessions/h/player');
    assert.ok(!JSON.stringify(initial).includes('BATCH_PUBLIC'));
    assert.ok(!JSON.stringify(initial).includes('OTHER_SECRET'));
    assert.ok(!JSON.stringify(inputs).includes('humanSeat'));
    assert.equal((await post('human-submit', { snapshotId: 'stale', messages: [], ready: false })).status, 400);
    let firstRoundWindows = 0;
    for (let step = 0; step < 40; step++) {
      const v = await wait(); if (v.status === 'completed') break;
      const p = await get('/api/sessions/h/player');
      assert.ok(p.pending && !p.pending.submitted);
      if (p.pending.phase === 'negotiation' && p.pending.round === 1) firstRoundWindows++;
      if (p.pending.logicalTimeMs > 0) {
        assert.ok(JSON.stringify(p.events).includes('FOR_YOU'));
        assert.ok(!JSON.stringify(p.events).includes('OTHER_SECRET'));
        assert.ok(!JSON.stringify(await get('/api/sessions/h')).includes('FOR_YOU'));
      }
      const body = p.pending.phase === 'commit'
        ? { snapshotId: p.pending.snapshotId, color: 'red' }
        : { snapshotId: p.pending.snapshotId, messages: [], ready: p.pending.round > 1 };
      assert.equal((await post('human-submit', body)).status, 200);
    }
    assert.equal(firstRoundWindows, 10);
    const done = await get('/api/sessions/h'); assert.equal(done.status, 'completed');
    assert.equal(done.state.outcome.agentId, 'A');
    assert.equal((await post('human-submit', { snapshotId: initial.pending.snapshotId, messages: [], ready: false })).status, 400);
  } finally { app.stop(); store.close(); }
});

test('saved human input is immutable and resumes without recalling successful AI peers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'minority-human-')), path = join(directory, 'test.sqlite');
  let store = new SqliteEventStore(path); const c = config(); store.createSession('s', c); let calls = 0;
  const controllers = Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput) => { calls++; return answer(i); } }]));
  try {
    assert.equal(await new DecisionCoordinator(store, 's', controllers).step(async () => {}), 'waiting_human');
    const pending = (await store.loadCheckpoint('s'))!.pendingDecisions.find(p => p.snapshot.input.agentId === 'A')!;
    const result = humanDecision({ snapshotId: pending.snapshot.snapshotId, messages: [], ready: false }, pending.snapshot.input, c.players);
    store.submitHuman('s', pending.snapshot.snapshotId, result);
    assert.throws(() => store.submitHuman('s', pending.snapshot.snapshotId, { ...result, actions: [] }));
    store.close(); store = new SqliteEventStore(path);
    await new DecisionCoordinator(store, 's', controllers).step(async () => {});
    assert.equal(calls, 4);
    assert.ok((await store.readEvents('s', 0)).some(e => e.data.type === 'public_message'));
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('human may submit while AI is pending, with no partial publication or human timeout', async () => {
  const c = config(), store = new SqliteEventStore(':memory:'); store.createSession('concurrent', c);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controllers = Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput) => { await gate; return answer(i); } }]));
  const running = new DecisionCoordinator(store, 'concurrent', controllers).step(async () => {});
  try {
    let cp = await store.loadCheckpoint('concurrent');
    for (let n = 0; n < 100 && !cp?.pendingDecisions.length; n++) { await new Promise(r => setTimeout(r, 1)); cp = await store.loadCheckpoint('concurrent'); }
    const human = cp!.pendingDecisions.find(p => p.snapshot.input.agentId === 'A')!;
    assert.throws(() => humanDecision({ snapshotId: human.snapshot.snapshotId, messages: [], ready: false, color: 'red' }, human.snapshot.input, c.players));
    assert.throws(() => humanDecision({ snapshotId: human.snapshot.snapshotId, messages: [{ recipientId: 'A', message: 'self' }], ready: false }, human.snapshot.input, c.players));
    const submitted = humanDecision({ snapshotId: human.snapshot.snapshotId, messages: [{ message: 'HUMAN_NOW' }], ready: false }, human.snapshot.input, c.players);
    store.submitHuman('concurrent', human.snapshot.snapshotId, submitted);
    assert.equal((await store.readEvents('concurrent', 0)).length, 0);
    release(); assert.equal(await running, 'running');
    const events = await store.readEvents('concurrent', 0);
    const publicEvents = events.filter(e => e.data.type === 'public_message');
    assert.equal(publicEvents.length, 2);
    assert.equal(new Set(publicEvents.map(e => e.batchId)).size, 1);
  } finally { release(); await running.catch(() => {}); store.close(); }
});
