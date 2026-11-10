import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expressionFor, publicSpeech, groupBatches, roundResults } from '../web/src/presentation.ts';
import type { PublicEvent } from '../src/contracts/public.ts';
const event = (type: string, publicPayload: Record<string, unknown>, logicalTimeMs = 0): PublicEvent => ({ type, publicPayload, logicalTimeMs, eventId: `${type}:${logicalTimeMs}`, batchId: 'b', commitSeq: 1 });

test('same timestamp does not merge distinct decision batches', () => {
  const a = event('public_message', { sender: 'A', body: 'a' });
  const b = { ...a, eventId: 'b', batchId: 'second' };
  assert.deepEqual(groupBatches([a, a, b]).map(g => g.events.length), [2, 1]);
});

test('stage speech only selects actual public messages from the current round', () => {
  const hidden = event('private_message_sent', { sender: 'A', recipient: 'B', body: 'SECRET' }, 5000);
  const current = event('public_message', { sender: 'C', body: '公開發言' }, 5000);
  assert.deepEqual(publicSpeech([hidden, event('public_message', { sender: 'A', body: '上回合' }), current], 5000), [current]);
});

test('unrevealed choices, private notes and readiness never drive facial expressions', () => {
  const events = [event('vote_committed', { actorId: 'A', color: 'red' }), event('strategy_note', { actorId: 'A', note: { plan: '秘密計畫' } }), event('ready_changed', { actorId: 'A', ready: true }), event('scores_updated', { deltas: [{ agentId: 'A', score: 5, minorityWins: 1 }] })];
  assert.equal(expressionFor('A', undefined, 'negotiation', events), 'neutral');
  assert.equal(expressionFor('A', undefined, 'commit', events), 'neutral');
  assert.equal(expressionFor('A', 'A', 'negotiation', events), 'speaking');
  assert.equal(expressionFor('B', 'A', 'negotiation', events), 'neutral');
});

test('reveal expressions reflect the latest public score delta, not total rank or inferred intent', () => {
  const events = [event('scores_updated', { deltas: [{ agentId: 'A', score: 5 }] }), event('scores_updated', { deltas: [{ agentId: 'A', score: -2 }, { agentId: 'B', score: 3 }, { agentId: 'C', score: 0 }] }, 5000)];
  assert.equal(expressionFor('A', undefined, 'reveal', events), 'surprised');
  assert.equal(expressionFor('B', undefined, 'completed', events), 'smile');
  assert.equal(expressionFor('C', undefined, 'reveal', events), 'neutral');
});

test('round results persist after next round, accumulate legacy payment deltas and ignore secret votes', () => {
  const events = [
    event('vote_committed', { actorId: 'A', color: 'blue' }),
    event('votes_revealed', { votes: { A: 'red', B: 'blue', C: 'red', D: 'blue', E: 'blue' } }),
    event('scores_updated', { deltas: [{ agentId: 'A', score: 2 }, { agentId: 'C', score: 2 }] }),
    event('scores_updated', { deltas: [{ agentId: 'A', score: -2 }, { agentId: 'B', score: 2 }] }),
    event('round_started', { round: 2 }),
    event('vote_committed', { actorId: 'A', color: 'blue' }),
  ];
  const results = roundResults(events);
  assert.equal(results.length, 1); assert.equal(results[0]!.round, 1);
  assert.deepEqual(results[0]!.minority, ['A', 'C']);
  assert.deepEqual(results[0]!.net, { A: 0, B: 2, C: 2 });
  assert.equal(results[0]!.votes.A, 'red');
});

test('history follows replay prefix and does not attribute old-round deltas to a new round', () => {
  const first = event('votes_revealed', { votes: { A: 'red', B: 'red', C: 'red', D: 'red', E: 'red' } });
  const second = event('votes_revealed', { votes: { A: 'blue', B: 'red', C: 'red', D: 'red', E: 'red' } });
  const events = [first, event('round_started', { round: 2 }), event('scores_updated', { deltas: [{ agentId: 'A', score: 99 }] }), second];
  assert.deepEqual(roundResults(events.slice(0, 1))[0]!.minority, []);
  assert.equal(roundResults(events.slice(0, 1))[0]!.settled, false);
  assert.deepEqual(roundResults(events).map(r => r.round), [1, 2]);
  assert.deepEqual(roundResults(events)[1]!.minority, ['A']);
  assert.deepEqual(roundResults(events)[0]!.net, {});
});
