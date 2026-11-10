import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseConfig } from '../src/domain/config.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { createApp } from '../src/server/app.ts';
import { RESPONSE_START, RESPONSE_END } from '../src/controllers/manual-file.ts';

test('mixed manual/human mode accepts either order, persists partial submissions and keeps votes sealed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'manual-human-'));
  const config = parseConfig({ ...JSON.parse(readFileSync('configs/experimental.json', 'utf8')), decisionMode: 'manual_file', humanSeat: 'A' });
  let store = new SqliteEventStore(join(dir, 'games.sqlite'));
  store.createSession('mixed', config);
  let app = createApp({ store, config, manualRoot: dir });
  let base = '', token = '';
  const startServer = async () => {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    token = (await (await fetch(`${base}/api/bootstrap`)).json()).token;
  };
  const get = async (suffix: string) => (await fetch(`${base}/api/sessions/mixed/${suffix}`, { headers: { 'X-Operation-Token': token } })).json();
  const post = async (suffix: string, body = {}) => fetch(`${base}/api/sessions/mixed/${suffix}`, { method: 'POST', headers: { 'X-Operation-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const until = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 8000;
    while (!await check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 25)); }
  };
  const fill = async (seat: string) => {
    const p = (await store.loadCheckpoint('mixed'))!.pendingDecisions.find(p => p.snapshot.input.agentId === seat)!;
    const i = p.snapshot.input, path = join(dir, 'mixed', `player-${seat}.md`), content = readFileSync(path, 'utf8');
    if (i.logicalTimeMs === 0 && i.phase === 'negotiation') assert.ok(!content.includes('HUMAN_PENDING_SECRET'));
    const response = { requestId: i.snapshotId, decision: {
      actions: i.phase === 'commit' ? [{ type: 'vote', color: 'blue', actionId: 'vote', scheduledTimeMs: i.logicalTimeMs }] : [{ type: 'send_public_message', message: 'AI_PENDING_SECRET', actionId: 'message', scheduledTimeMs: i.logicalTimeMs }, { type: 'set_ready', ready: true, actionId: 'ready', scheduledTimeMs: i.logicalTimeMs }],
      nextWake: { atGameTimeMs: null, onEvents: [] }, strategyNote: { goal: '測試', plan: '腳本', whyThisAction: '測試', predictedOutcome: '未知', observedEventIds: [], revisionReason: null },
    } };
    writeFileSync(path, content.slice(0, content.indexOf(RESPONSE_START)) + RESPONSE_START + '\n' + JSON.stringify(response) + '\n' + RESPONSE_END);
  };
  try {
    await startServer(); assert.equal((await post('start')).status, 200);
    await until(async () => (await get('')).status === 'waiting_manual');
    assert.equal(existsSync(join(dir, 'mixed', 'player-A.md')), false);
    const progress = await get('manual');
    assert.equal(progress.players.filter((p: { file: string | null }) => p.file).length, 4);
    assert.equal(progress.players[0].status, '等待你提交'); assert.equal(progress.players[0].file, null);
    const player = await get('player');
    assert.equal((await post('human-submit', { snapshotId: player.pending.snapshotId, messages: [{ message: 'HUMAN_PENDING_SECRET' }], ready: false })).status, 200);
    assert.equal((await get('manual')).players[0].status, '你已提交');
    assert.equal((await post('human-submit', { snapshotId: player.pending.snapshotId, messages: [], ready: false })).status, 400, 'submitted human action is immutable');
    await fill('B');
    await until(async () => Boolean((await store.loadCheckpoint('mixed'))!.pendingDecisions.find(p => p.snapshot.input.agentId === 'B')!.result));
    assert.equal((await store.readEvents('mixed', 0)).length, 0);
    const clock = (await store.loadCheckpoint('mixed'))!.logicalTimeMs;
    app.stop(); await new Promise(r => setTimeout(r, 1200)); store.close();
    store = new SqliteEventStore(join(dir, 'games.sqlite'));
    app = createApp({ store, config, manualRoot: dir }); await startServer();
    assert.ok((await get('player')).pending.submitted);
    assert.equal((await post('resume')).status, 200);
    for (const seat of ['C', 'D', 'E']) await fill(seat);
    await until(async () => (await get('')).status === 'waiting_human');
    assert.ok((await get('')).events.some((e: { type: string }) => e.type === 'public_message'));
    assert.equal(clock, 0);
    const next = await get('player');
    assert.equal((await post('human-submit', { snapshotId: next.pending.snapshotId, messages: [], ready: true })).status, 200);
    await until(async () => (await get('manual')).players.filter((p: { phase: string }) => p.phase === 'commit').length === 5);
    for (const seat of ['B', 'C', 'D', 'E']) await fill(seat);
    await until(async () => (await get('')).status === 'waiting_human');
    assert.ok(!(await get('')).events.some((e: { type: string }) => e.type === 'votes_revealed'));
    assert.equal((await get('player')).pending.submitted, false);
    assert.equal(existsSync(join(dir, 'mixed', 'player-A.md')), false);
    app.stop(); await new Promise(r => setTimeout(r, 1200)); store.close();
    store = new SqliteEventStore(join(dir, 'games.sqlite'));
    app = createApp({ store, config, manualRoot: dir }); await startServer();
    assert.equal((await get('')).status, 'paused_error', 'restart while waiting for a human permits explicit resume');
    assert.equal((await post('resume')).status, 200);
    await until(async () => (await get('')).status === 'waiting_human');
    assert.equal((await get('manual')).players.filter((p: { status: string }) => p.status === '已接受').length, 4);
    const vote = await get('player');
    assert.equal((await post('human-submit', { snapshotId: vote.pending.snapshotId, color: 'red' })).status, 200);
    await until(async () => (await get('')).events.some((e: { type: string }) => e.type === 'votes_revealed'));
    const view = await get('');
    assert.equal(view.events.find((e: { type: string }) => e.type === 'votes_revealed').publicPayload.votes.A, 'red');
    assert.equal(view.state.standings.find((s: { agentId: string }) => s.agentId === 'A').score, 5);
  } finally { app.stop(); await new Promise(r => setTimeout(r, 1200)); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
