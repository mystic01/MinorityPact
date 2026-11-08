import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualFileController, RESPONSE_START, RESPONSE_END } from '../src/controllers/manual-file.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { parseConfig } from '../src/domain/config.ts';

test('manual files pause, validate identity, retain partial results across restart and finish offline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minority-manual-'));
  let store = new SqliteEventStore(join(dir, 'game.sqlite'));
  const config = parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
  config.rounds = 5;
  store.createSession('manual-test', config);
  const controllers = () => Object.fromEntries(config.players.map(id => [id, new ManualFileController(dir)]));
  let coordinator = new DecisionCoordinator(store, 'manual-test', controllers());
  const step = () => coordinator.step(async () => {});
  const fill = async (only?: string, wrong = false) => {
    for (const p of (await store.loadCheckpoint('manual-test'))!.pendingDecisions) {
      const i = p.snapshot.input;
      if (p.result || only && i.agentId !== only) continue;
      const path = join(dir, `player-${i.agentId}.md`);
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('完整遊戲與行動規則'));
      const result = { requestId: wrong ? 'old-request' : i.snapshotId, decision: {
        actions: i.phase === 'commit' ? [{ actionId: 'vote', scheduledTimeMs: i.logicalTimeMs, type: 'vote', color: i.agentId === 'A' ? 'red' : 'blue' }] : [{ actionId: 'ready', scheduledTimeMs: i.logicalTimeMs, type: 'set_ready', ready: true }],
        nextWake: { atGameTimeMs: null, onEvents: [] }, strategyNote: { goal: '獨勝', plan: '測試', whyThisAction: '離線測試', predictedOutcome: '未知', observedEventIds: [], revisionReason: null },
      } };
      writeFileSync(path, content.slice(0, content.indexOf(RESPONSE_START)) + RESPONSE_START + '\n' + JSON.stringify(result) + '\n' + RESPONSE_END);
    }
  };
  try {
    assert.equal(await step(), 'waiting_manual');
    const initialTime = (await store.loadCheckpoint('manual-test'))!.logicalTimeMs;
    await fill('A', true);
    assert.equal(await step(), 'waiting_manual');
    assert.ok(readFileSync(join(dir, 'player-A.md'), 'utf8').includes('old-request'));
    await fill('A');
    assert.equal(await step(), 'waiting_manual');
    assert.equal((await store.readEvents('manual-test', 0)).length, 0);
    assert.equal((await store.loadCheckpoint('manual-test'))!.logicalTimeMs, initialTime);
    store.close(); store = new SqliteEventStore(join(dir, 'game.sqlite'));
    coordinator = new DecisionCoordinator(store, 'manual-test', controllers());
    assert.ok((await store.loadCheckpoint('manual-test'))!.pendingDecisions.find(p => p.snapshot.input.agentId === 'A')!.result);
    let completed = false;
    for (let n = 0; n < 100; n++) {
      const status = await step();
      if (status === 'completed') { completed = true; break; }
      if (status === 'waiting_manual') await fill();
    }
    assert.equal(completed, true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
