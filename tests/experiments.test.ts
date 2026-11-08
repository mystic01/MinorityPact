import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { experimentMatrix, summarize } from '../src/experiments/report.ts';
import { parseConfig } from '../src/domain/config.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import type { DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
const base = () => parseConfig(JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8')));
test('12-cell scripted matrix validates both policies, three scheduler modes and 10/12 rounds', async () => {
  const matrix = experimentMatrix(base()); assert.equal(matrix.length, 12);
  for (const c of matrix) {
    parseConfig(c);
    const store = new SqliteEventStore(':memory:'); store.createSession('s', c);
    const controllers = Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput): Promise<DecisionResult> => ({
      actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: i.agentId === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [], nextWake: { onEvents: [] },
      strategyNote: { goal: 'win', plan: 'wait', whyThisAction: 'observe', predictedOutcome: 'unknown', observedEventIds: [] },
    }) }]));
    try {
      const coordinator = new DecisionCoordinator(store, 's', controllers);
      for (let n = 0; n < 100; n++) if (await coordinator.step(async () => {}) === 'completed') break;
      const report = await summarize(store, 's'); assert.equal(report.complete, true); assert.equal(report.revealedRounds, c.rounds);
      assert.equal(report.standings[0]?.score, c.rounds * c.scoring.solo); assert.equal(report.source, 'scripted_or_imported');
      if (c.scoring.policy === 'zero_sum') assert.equal(report.standings.reduce((sum, s) => sum + s.score, 0), 0);
      assert.ok(!JSON.stringify(report).includes('whyThisAction'));
    } finally { store.close(); }
  }
});
