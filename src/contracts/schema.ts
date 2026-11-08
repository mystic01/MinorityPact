import type { Action, DecisionResult } from './decision.ts';
import { array, integer, keys, object, oneOf, text } from './validation.ts';
export function parseAction(value: unknown): Action {
  const v = object(value);
  const type = oneOf(v.type, ['send_public_message', 'send_private_message', 'set_ready', 'vote']);
  const base = { actionId: text(v.actionId), scheduledTimeMs: integer(v.scheduledTimeMs) };
  const fields = ['type', 'actionId', 'scheduledTimeMs'];
  if (type === 'vote') { keys(v, [...fields, 'color']); return { ...base, type, color: oneOf(v.color, ['red', 'blue']) }; }
  if (type === 'set_ready') {
    keys(v, [...fields, 'ready']);
    if (typeof v.ready !== 'boolean') throw new Error('Expected ready boolean');
    return { ...base, type, ready: v.ready };
  }
  keys(v, [...fields, 'message', ...(type === 'send_private_message' ? ['recipientId'] : [])]);
  const message = text(v.message);
  return type === 'send_private_message' ? { ...base, type, message, recipientId: text(v.recipientId) } : { ...base, type, message };
}
export function parseDecision(value: unknown): DecisionResult {
  const v = object(value); keys(v, ['actions', 'nextWake', 'strategyNote']);
  const actions = array(v.actions).map(parseAction);
  if (new Set(actions.map(a => a.actionId)).size !== actions.length) throw new Error('Duplicate actionId');
  const w = object(v.nextWake); keys(w, ['atGameTimeMs', 'onEvents']);
  const n = object(v.strategyNote);
  keys(n, ['goal', 'plan', 'whyThisAction', 'predictedOutcome', 'observedEventIds', 'revisionReason']);
  return {
    actions,
    nextWake: {
      ...(w.atGameTimeMs === undefined ? {} : { atGameTimeMs: integer(w.atGameTimeMs) }),
      onEvents: array(w.onEvents).map(e => oneOf(e, ['private_message_received', 'public_message_received'])),
    },
    strategyNote: {
      goal: text(n.goal), plan: text(n.plan), whyThisAction: text(n.whyThisAction), predictedOutcome: text(n.predictedOutcome),
      observedEventIds: array(n.observedEventIds).map(text),
      ...(n.revisionReason === undefined ? {} : { revisionReason: text(n.revisionReason) }),
    },
  };
}
