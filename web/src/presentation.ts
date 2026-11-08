import type { PublicEvent, Standing } from '../../src/contracts/public.ts';

export type Expression = 'neutral' | 'speaking' | 'smile' | 'doubtful' | 'surprised';

// Presentation consumes the same public projection as the journal. It never infers
// votes, readiness, private intent, or whether an individual provider is thinking.
export function expressionFor(agentId: string, speaker: string | undefined, phase: string | undefined, events: PublicEvent[]): Expression {
  if (speaker === agentId) return 'speaking';
  if (phase !== 'reveal' && phase !== 'completed') return 'neutral';
  const scoreEvent = events.findLast(e => e.type === 'scores_updated');
  const delta = (scoreEvent?.publicPayload.deltas as Standing[] | undefined)?.find(s => s.agentId === agentId)?.score ?? 0;
  return delta > 0 ? 'smile' : delta < 0 ? 'surprised' : 'neutral';
}

export function publicSpeech(events: PublicEvent[], roundStartedMs: number): PublicEvent[] {
  return events.filter(e => e.type === 'public_message' && e.logicalTimeMs >= roundStartedMs && typeof e.publicPayload.sender === 'string' && typeof e.publicPayload.body === 'string');
}
