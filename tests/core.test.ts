import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/domain/config.ts';
import { parseDecision } from '../src/contracts/schema.ts';
import { createGame, rank, reduce, resolveBatch, scoreVotes } from '../src/domain/engine.ts';
import type { Batch, GameState } from '../src/domain/engine.ts';
import type { Action } from '../src/contracts/decision.ts';
import type { Color } from '../src/contracts/public.ts';
const raw = () => JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8'));
const config = () => parseConfig({ ...raw(), llm: { provider: 'openrouter', model: 'test/model', parameters: {} } });
const ids = ['A', 'B', 'C', 'D', 'E'];
const apply = (s: GameState, actions: Batch['actions'] = [], time = s.logicalTimeMs): GameState => resolveBatch(s, { batchId: 'test', logicalTimeMs: time, actions, hasPendingMessages: false }).reduce(reduce, s);
const action = (actorId: string, a: Action) => ({ actorId, action: a });
test('configuration rejects empty model, missing rules, duplicate/unequal seats and secrets', () => {
  assert.throws(() => parseConfig(raw()));
  const c = config(); assert.equal(c.llm.model, 'test/model');
  for (const field of ['rounds', 'policies', 'scoring', 'negotiationTimeMs']) { const v = { ...c }; delete (v as Record<string, unknown>)[field]; assert.throws(() => parseConfig(v)); }
  assert.throws(() => parseConfig({ ...c, players: ['A', 'A', 'C', 'D', 'E'] }));
  assert.throws(() => parseConfig({ ...c, players: ['A', 'B'] }));
  assert.throws(() => parseConfig({ ...c, seats: [{ model: 'different' }] }));
  assert.throws(() => parseConfig({ ...c, llm: { ...c.llm, apiKey: 'secret' } }));
  assert.throws(() => parseConfig({ ...c, scoring: { policy: 'zero_sum', solo: 8, pair: 4, majority: -2 } }));
});
for (const policy of ['exclusive', 'zero_sum'] as const) {
  for (let mask = 0; mask < 32; mask++) test(`${policy}: vote pattern ${mask}`, () => {
    const votes = Object.fromEntries(ids.map((id, i) => [id, mask & (1 << i) ? 'red' : 'blue'])) as Record<string, Color>;
    const scoring = policy === 'exclusive' ? { policy, solo: 5, pair: 2, majority: 0 } : { policy, solo: 8, pair: 3, majority: -2 };
    const result = scoreVotes(ids, votes, scoring);
    const reds = Object.values(votes).filter(v => v === 'red').length;
    const size = Math.min(reds, 5 - reds);
    for (const r of result) {
      const won = size > 0 && votes[r.agentId] === (reds < 3 ? 'red' : 'blue');
      assert.equal(r.minorityWins, Number(won));
      assert.equal(r.score, size === 0 ? 0 : won ? size === 1 ? scoring.solo : scoring.pair : scoring.majority);
    }
    if (policy === 'zero_sum') assert.equal(result.reduce((sum, r) => sum + r.score, 0), 0);
  });
}
test('ranking uses score then minority count, no third tiebreak', () => {
  const s = [{ agentId: 'A', score: 5, minorityWins: 1 }, { agentId: 'B', score: 5, minorityWins: 2 }];
  assert.deepEqual(rank(s), { kind: 'winner', agentId: 'B' });
  assert.deepEqual(rank(s.map(r => ({ ...r, minorityWins: 1 }))), { kind: 'draw', agentIds: ['A', 'B'] });
  assert.deepEqual(rank([{ ...s[0]!, score: 6 }, s[1]!]), { kind: 'winner', agentId: 'A' });
});
test('ready revocation, new message blocks same-batch early finish, silence permits finish', () => {
  let s = createGame('s', config());
  s = apply(s, ids.map(id => action(id, { type: 'set_ready', actionId: 'ready', ready: true, scheduledTimeMs: 0 })).concat([action('A', { type: 'send_private_message', actionId: 'msg', recipientId: 'B', message: 'secret', scheduledTimeMs: 0 })]));
  assert.equal(s.phase, 'negotiation');
  s = apply(s, [action('A', { type: 'set_ready', actionId: 'unready', ready: false, scheduledTimeMs: 0 })]);
  assert.equal(s.phase, 'negotiation');
  s = apply(s, [action('A', { type: 'set_ready', actionId: 'again', ready: true, scheduledTimeMs: 0 })]);
  assert.equal(s.phase, 'commit');
});
test('illegal actor, recipient, color, duplicate actions and mixed illegal batch leave input unchanged', () => {
  const s = createGame('s', config()); const before = structuredClone(s);
  const vote = { type: 'vote', actionId: 'v', color: 'red', scheduledTimeMs: 0 } as const;
  assert.throws(() => apply(s, [action('A', vote)]));
  assert.throws(() => apply(s, [action('Z', { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: 0 })]));
  assert.throws(() => apply(s, [action('A', { type: 'send_private_message', actionId: 'm', recipientId: 'Z', message: 'hi', scheduledTimeMs: 0 })]));
  const ready = action('A', { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: 0 });
  assert.throws(() => apply(s, [ready, ready])); assert.deepEqual(s, before);
  const committed = apply(s, [], config().negotiationTimeMs);
  assert.throws(() => apply(committed, [action('A', { ...vote, scheduledTimeMs: committed.logicalTimeMs, color: 'green' } as unknown as Action)]));
});
test('ten/twelve scripted rounds accumulate, reveal only after five votes, no elimination', () => {
  for (const rounds of [10, 12]) {
    let s = createGame('s', { ...config(), rounds });
    for (let round = 1; round <= rounds; round++) {
      s = apply(s, [], s.roundStartedMs + s.rules.negotiationTimeMs);
      const time = s.logicalTimeMs;
      const votes = ids.map((id, i) => action(id, { type: 'vote', actionId: `vote-${round}`, color: i === 0 ? 'red' : 'blue', scheduledTimeMs: time }));
      s = apply(s, votes.slice(0, 4)); assert.equal(s.phase, 'commit');
      assert.throws(() => apply(s, [votes[0]!]));
      s = apply(s, votes.slice(4)); assert.equal(s.phase, 'reveal');
      assert.throws(() => apply(s, [votes[0]!]));
      s = apply(s); assert.equal(s.standings.length, 5);
    }
    assert.equal(s.phase, 'completed'); assert.equal(s.standings[0]!.score, rounds * 5);
    assert.equal(s.standings[0]!.minorityWins, rounds);
    assert.deepEqual(s.outcome, { kind: 'winner', agentId: 'A' }); assert.throws(() => apply(s));
  }
});
test('deadline, scheduled action boundary, pending messages and empty wait', () => {
  const s = createGame('s', config()); assert.equal(apply(s).phase, 'negotiation');
  assert.throws(() => apply(s, [action('A', { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: 1 })]));
  assert.throws(() => apply(s, [action('A', { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: s.rules.negotiationTimeMs })], s.rules.negotiationTimeMs));
  const ready = { ...s, ready: Object.fromEntries(ids.map(id => [id, true])) };
  assert.deepEqual(resolveBatch(ready, { batchId: 'b', logicalTimeMs: 0, actions: [], hasPendingMessages: true }), []);
  assert.equal(apply(ready).phase, 'commit');
});
test('decision schema accepts silent wait and rejects malformed output', () => {
  const d = { actions: [], nextWake: { onEvents: ['private_message_received'] }, strategyNote: { goal: 'win', plan: 'wait', whyThisAction: 'observe', predictedOutcome: 'unknown', observedEventIds: [] } };
  assert.equal(parseDecision(d).actions.length, 0);
  assert.throws(() => parseDecision({ ...d, nextWake: { onEvents: ['secret_of_other_agent'] } }));
  assert.throws(() => parseDecision({ ...d, strategyNote: {} }));
});
