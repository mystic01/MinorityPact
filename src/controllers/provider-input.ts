import type { DecisionInput } from '../contracts/decision.ts';

// Keep the persisted/internal snapshot intact; remove only redundant wire copies.
// Legacy/custom snapshots may contain information absent from history: retain it.
export function providerInput(input: Readonly<DecisionInput>) {
  const { ownNotes, privateMessages, ...rest } = input;
  const noteCopies = input.history.filter(e => e.type === 'strategy_note' && e.publicPayload.actorId === input.agentId)
    .map(e => JSON.stringify(e.publicPayload.note));
  const extraNotes = ownNotes.filter(note => {
    const index = noteCopies.indexOf(JSON.stringify(note));
    if (index < 0) return true;
    noteCopies.splice(index, 1); return false;
  });
  const extraMessages = privateMessages.filter(message => !input.history.some(e =>
    e.type === 'private_message_sent' && e.eventId === message.eventId &&
    e.publicPayload.sender === message.sender && e.publicPayload.recipient === message.recipient && e.publicPayload.body === message.body));
  return { ...rest, ...(extraNotes.length ? { ownNotes: extraNotes } : {}), ...(extraMessages.length ? { privateMessages: extraMessages } : {}) };
}
