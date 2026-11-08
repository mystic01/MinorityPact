import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { ReplayService } from '../src/application/replay.ts';
import { parseConfig } from '../src/domain/config.ts';
import { createGame, reduce, resolveBatch } from '../src/domain/engine.ts';
import type { DomainEvent } from '../src/domain/engine.ts';
import type { CommitRequest, SchedulerCheckpoint, StoredEvent } from '../src/application/ports.ts';
const config = () => parseConfig({ ...JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8')), llm: { provider: 'openrouter', model: 'test/model', displayName: 'Test Model', parameters: {} } });
const checkpoint = (time = 0): SchedulerCheckpoint => ({ logicalTimeMs: time, subscriptions: {}, pendingDecisions: [], pendingActions: [] });
const envelope = (data: DomainEvent, seq: number): StoredEvent => ({ eventId: `e${seq}`, sessionId: 's', round: 1, phase: 'negotiation', schemaVersion: 1, batchId: data.batchId, logicalTimeMs: data.logicalTimeMs, commitSeq: seq, data });
const request = (events: StoredEvent[], batchId = 'b', expectedVersion = 0): CommitRequest => ({ sessionId: 's', batchId, expectedVersion, events, checkpoint: checkpoint(events.at(-1)?.logicalTimeMs ?? 0) });
test('transaction rollback leaves no partial batch; retries idempotent, changed retry rejected', async () => {
  const store = new SqliteEventStore(':memory:');
  try {
    store.createSession('s', config());
    const d: DomainEvent = { type: 'public_message', actorId: 'A', body: 'hello', logicalTimeMs: 0, batchId: 'b' };
    const e = envelope(d, 1);
    await assert.rejects(store.commitBatch(request([e, { ...envelope(d, 2), eventId: e.eventId }])));
    assert.deepEqual(await store.readEvents('s', 0), []); assert.equal(await store.loadCheckpoint('s'), null);
    const r = request([e]);
    assert.deepEqual(await store.commitBatch(r), { kind: 'committed', version: 1 });
    assert.deepEqual(await store.commitBatch(r), { kind: 'already_committed', version: 1 });
    await assert.rejects(store.commitBatch({ ...r, events: [] }));
    assert.deepEqual(await store.commitBatch(request([], 'new')), { kind: 'version_conflict', actualVersion: 1 });
    assert.equal((await store.readEvents('s', 0)).length, 1);
  } finally { store.close(); }
});
test('disk reopen preserves subscriptions and pending actions exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minority-'));
  const path = join(dir, 'game.sqlite'); let store = new SqliteEventStore(path);
  try {
    store.createSession('s', config());
    const cp = checkpoint(5); cp.subscriptions.A = { onEvents: ['private_message_received'] };
    cp.pendingActions.push({ actorId: 'A', decisionId: 'd', action: { type: 'send_public_message', actionId: 'future', scheduledTimeMs: 10, message: 'later' } });
    await store.commitBatch({ ...request([]), checkpoint: cp });
    store.close(); store = new SqliteEventStore(path);
    assert.deepEqual(await store.loadCheckpoint('s'), cp);
    assert.equal(store.getConfig('s').llm.displayName, 'Test Model');
    assert.deepEqual(await store.commitBatch({ ...request([]), checkpoint: cp }), { kind: 'already_committed', version: 1 });
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('spectator and unrelated agents never receive private sentinel, notes or unrevealed votes', async () => {
  const store = new SqliteEventStore(':memory:');
  try {
    store.createSession('s', config());
    const data: DomainEvent[] = [
      { type: 'private_message_sent', actorId: 'A', recipientId: 'B', body: 'PRIVATE_SENTINEL', batchId: 'b', logicalTimeMs: 0 },
      { type: 'strategy_note', actorId: 'A', note: { goal: 'STRATEGY_SENTINEL', plan: 'wait', whyThisAction: 'observe', predictedOutcome: 'unknown', observedEventIds: [] }, batchId: 'b', logicalTimeMs: 0 },
      { type: 'vote_committed', actorId: 'A', color: 'red', batchId: 'b', logicalTimeMs: 0 },
    ];
    await store.commitBatch(request(data.map((d, i) => envelope(d, i + 1))));
    const replay = new ReplayService(store);
    for (const viewer of [{ kind: 'spectator' } as const, ...['C', 'D', 'E'].map(agentId => ({ kind: 'agent' as const, agentId }))]) {
      const view = await replay.read('s', viewer);
      const json = JSON.stringify(view);
      assert.ok(!json.includes('SENTINEL')); assert.ok(!json.includes('vote_committed'));
      assert.deepEqual(view.events[0]?.publicPayload, { sender: 'A', recipient: 'B' });
      assert.ok(!JSON.stringify(await replay.read('s', viewer, 1, 0)).includes('SENTINEL'));
    }
    const a = JSON.stringify(await replay.read('s', { kind: 'agent', agentId: 'A' }));
    assert.ok(a.includes('PRIVATE_SENTINEL') && a.includes('STRATEGY_SENTINEL'));
    const b = JSON.stringify(await replay.read('s', { kind: 'agent', agentId: 'B' }));
    assert.ok(b.includes('PRIVATE_SENTINEL') && !b.includes('STRATEGY_SENTINEL'));
    await assert.rejects(replay.read('s', { kind: 'omniscient' }));
    await assert.rejects(replay.read('s', { kind: 'agent', agentId: 'Z' }));
  } finally { store.close(); }
});
test('completed replay unlocks original note at original cursor and seeks scores without future leakage', async () => {
  const store = new SqliteEventStore(':memory:');
  try {
    const c = config(); store.createSession('s', c); let state = createGame('s', c); const all: StoredEvent[] = []; let n = 0;
    const append = (data: DomainEvent[]) => { for (const d of data) { all.push(envelope(d, all.length + 1)); state = reduce(state, d); } };
    append([{ type: 'strategy_note', actorId: 'A', batchId: 'all', logicalTimeMs: 0, note: { goal: 'ORIGINAL', plan: 'wait', whyThisAction: 'observe', predictedOutcome: 'unknown', observedEventIds: [] } }]);
    while (state.phase !== 'completed') {
      const time = state.phase === 'negotiation' ? state.roundStartedMs + c.negotiationTimeMs : state.logicalTimeMs;
      append(resolveBatch(state, { batchId: 'all', logicalTimeMs: time, hasPendingMessages: false,
        actions: state.phase === 'commit' ? c.players.map((actorId, i) => ({ actorId, action: { type: 'vote' as const, actionId: `v${++n}`, color: i === 0 ? 'red' as const : 'blue' as const, scheduledTimeMs: time } })) : [] }));
    }
    await store.commitBatch({ ...request(all, 'all'), checkpoint: checkpoint(state.logicalTimeMs) });
    const service = new ReplayService(store);
    const early = await service.read('s', { kind: 'omniscient' }, 1);
    assert.equal(early.state.standings[0]?.score, 0); assert.equal(early.events[0]?.publicPayload.note && (early.events[0].publicPayload.note as { goal: string }).goal, 'ORIGINAL');
    const end = await service.read('s', { kind: 'omniscient' });
    assert.equal(end.state.standings[0]?.score, 50);
    assert.deepEqual(end.state.standings, state.standings);
    const publicEnd = await service.read('s', { kind: 'spectator' }); assert.ok(!JSON.stringify(publicEnd).includes('ORIGINAL'));
    assert.deepEqual(await store.readEvents('s', 0), all);
    await assert.rejects(service.read('s', { kind: 'spectator' }, -1));
  } finally { store.close(); }
});
