import { array, object, keys, text, oneOf } from '../contracts/validation.ts';
import type { DecisionInput, DecisionResult, Action } from '../contracts/decision.ts';

// Identity, phase, action times and IDs come from the frozen server snapshot.
export function humanDecision(value: unknown, input: DecisionInput, players: string[]): DecisionResult {
  const v = object(value); keys(v, ['snapshotId', 'messages', 'ready', 'color']);
  if (text(v.snapshotId) !== input.snapshotId) throw new Error('Stale window');
  const actions: Action[] = [];
  if (input.phase === 'commit') {
    if (v.messages !== undefined || v.ready !== undefined) throw new Error('Vote only');
    actions.push({ actionId: 'vote', scheduledTimeMs: input.logicalTimeMs, type: 'vote', color: oneOf(v.color, ['red', 'blue']) });
  } else if (input.phase === 'negotiation') {
    if (v.color !== undefined || typeof v.ready !== 'boolean') throw new Error('Invalid negotiation');
    for (const [index, raw] of array(v.messages).entries()) {
      const m = object(raw); keys(m, ['recipientId', 'message']);
      const message = text(m.message).trim(); if (!message || message.length > 4000) throw new Error('Invalid message');
      const base = { actionId: `message-${index}`, scheduledTimeMs: input.logicalTimeMs, message };
      if (m.recipientId === undefined) actions.push({ ...base, type: 'send_public_message' });
      else {
        const recipientId = text(m.recipientId);
        if (!players.includes(recipientId) || recipientId === input.agentId) throw new Error('Invalid recipient');
        actions.push({ ...base, type: 'send_private_message', recipientId });
      }
    }
    actions.push({ actionId: 'ready', scheduledTimeMs: input.logicalTimeMs, type: 'set_ready', ready: v.ready });
  } else throw new Error('No input in this phase');
  return { actions, nextWake: { onEvents: [] }, strategyNote: {
    goal: input.ownNotes.at(-1)?.goal ?? '成為唯一冠軍', plan: '依本批提交行動執行。',
    whyThisAction: '未提供策略說明。', predictedOutcome: '未提供結果預測。', observedEventIds: [],
  } };
}
