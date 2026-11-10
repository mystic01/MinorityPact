import type { PublicEvent, Standing } from '../../src/contracts/public.ts';

export type Expression = 'neutral' | 'speaking' | 'smile' | 'doubtful' | 'surprised';

export interface RoundResult {
  round: number; votes: Record<string, string>; reds: number; blues: number; minority: string[];
  net: Record<string, number>; settled: boolean;
}
// Use only revealed public votes. Private committed votes must never populate results.
export function roundResults(events: PublicEvent[]): RoundResult[] {
  const results: RoundResult[] = []; let round = 1; let current: RoundResult | undefined;
  for (const event of events) {
    if (event.type === 'round_started') { round = Number(event.publicPayload.round); current = undefined; }
    if (event.type === 'votes_revealed') {
      const votes = { ...event.publicPayload.votes as Record<string, string> };
      const reds = Object.values(votes).filter(c => c === 'red').length;
      const blues = Object.values(votes).filter(c => c === 'blue').length;
      current = { round, votes, reds, blues, minority: reds && blues && reds !== blues ? Object.keys(votes).filter(id => votes[id] === (reds < blues ? 'red' : 'blue')) : [], net: {}, settled: false };
      results.push(current);
    }
    if (event.type === 'scores_updated' && current) {
      for (const d of event.publicPayload.deltas as Standing[]) current.net[d.agentId] = (current.net[d.agentId] ?? 0) + d.score;
      current.settled = true;
    }
  }
  return results;
}

export function groupBatches(events: PublicEvent[]): { batchId: string; events: PublicEvent[] }[] {
  const groups: { batchId: string; events: PublicEvent[] }[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (last?.batchId === event.batchId) last.events.push(event);
    else groups.push({ batchId: event.batchId, events: [event] });
  }
  return groups;
}

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
