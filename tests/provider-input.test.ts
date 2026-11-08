import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerInput } from '../src/controllers/provider-input.ts';
import type { DecisionInput } from '../src/contracts/decision.ts';

test('wire input contains each private message and note once without mutating snapshots', () => {
  const note = { goal: 'win', plan: 'PRIVATE_PLAN', whyThisAction: 'test', predictedOutcome: 'unknown', observedEventIds: [] };
  const message = { eventId: 'p', sender: 'B', recipient: 'A', body: 'PRIVATE_MESSAGE' };
  const input: DecisionInput = {
    sessionId: 's', round: 1, phase: 'negotiation', logicalTimeMs: 5000, batchId: 'b', snapshotId: 'snap', agentId: 'A', rulesVersion: 'v', publicRules: '{}', standings: [],
    history: [
      { eventId: 'n', batchId: 'b', commitSeq: 1, logicalTimeMs: 0, type: 'strategy_note', publicPayload: { actorId: 'A', note } },
      { eventId: 'p', batchId: 'b', commitSeq: 2, logicalTimeMs: 0, type: 'private_message_sent', publicPayload: { sender: 'B', recipient: 'A', body: message.body } },
    ], ownNotes: [note], privateMessages: [message], wakeReasons: [], newEventIds: ['p'],
  };
  const before = structuredClone(input), wire = providerInput(input), serialized = JSON.stringify(wire);
  assert.equal(serialized.split('PRIVATE_PLAN').length - 1, 1);
  assert.equal(serialized.split('PRIVATE_MESSAGE').length - 1, 1);
  assert.ok(!('ownNotes' in wire)); assert.ok(!('privateMessages' in wire));
  assert.deepEqual(wire.history, input.history); assert.deepEqual(wire.newEventIds, ['p']);
  assert.deepEqual(input, before);
  const legacy = providerInput({ ...input, history: [] });
  assert.deepEqual(legacy.ownNotes, [note]); assert.deepEqual(legacy.privateMessages, [message]);
  const repeated = providerInput({ ...input, ownNotes: [note, note] });
  assert.deepEqual(repeated.ownNotes, [note]);
});
