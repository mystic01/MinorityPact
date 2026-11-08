import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expressionFor, publicSpeech } from '../web/src/presentation.ts';
import type { PublicEvent } from '../src/contracts/public.ts';
const event = (type: string, publicPayload: Record<string, unknown>, logicalTimeMs = 0): PublicEvent => ({ type, publicPayload, logicalTimeMs, eventId: `${type}:${logicalTimeMs}`, batchId: 'b', commitSeq: 1 });

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
