import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancePlayback } from '../src/contracts/timeline.ts';
test('replay respects original logical gaps and unlocks simultaneous events together', () => {
  const events = [{ commitSeq: 1, logicalTimeMs: 0 }, { commitSeq: 2, logicalTimeMs: 5000 }, { commitSeq: 3, logicalTimeMs: 5000 }, { commitSeq: 4, logicalTimeMs: 15000 }];
  assert.equal(advancePlayback(events, 0, 1000, 1).cursor, 1);
  assert.equal(advancePlayback(events, 0, 1000, 5).cursor, 3);
  assert.deepEqual(advancePlayback(events, 5000, 10000, 16), { cursor: 4, logicalTimeMs: 15000, ended: true });
  assert.throws(() => advancePlayback(events, 0, -1, 1));
});
