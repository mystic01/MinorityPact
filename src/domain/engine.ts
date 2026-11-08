import type { Action } from '../contracts/decision.ts';
import type { Color, Outcome, Phase, Standing } from '../contracts/public.ts';
import { parseAction } from '../contracts/schema.ts';
import type { Rules } from './config.ts';
import type { StrategyNote } from '../contracts/decision.ts';
export interface GameState {
  sessionId: string; rules: Rules; round: number; phase: Phase; logicalTimeMs: number;
  roundStartedMs: number; standings: Standing[]; ready: Record<string, boolean>;
  votes: Record<string, Color>; usedActions: string[]; outcome: Outcome | null;
}
export type EventData =
  | { type: 'strategy_note'; actorId: string; note: StrategyNote }
  | { type: 'public_message'; actorId: string; body: string }
  | { type: 'private_message_sent'; actorId: string; recipientId: string; body: string }
  | { type: 'ready_changed'; actorId: string; ready: boolean }
  | { type: 'vote_committed'; actorId: string; color: Color }
  | { type: 'action_accepted'; key: string }
  | { type: 'phase_changed'; phase: Phase }
  | { type: 'round_started'; round: number }
  | { type: 'votes_revealed'; votes: Record<string, Color> }
  | { type: 'scores_updated'; deltas: Standing[] }
  | { type: 'game_ended'; outcome: Outcome };
// Internal event. It must never be serialized directly into a browser response.
export type DomainEvent = EventData & { logicalTimeMs: number; batchId: string };
export interface Batch { batchId: string; logicalTimeMs: number; actions: { actorId: string; action: Action }[]; hasPendingMessages: boolean }
export interface ReadyPolicy { shouldFinish(state: GameState, hasMessages: boolean, hasPendingMessages: boolean): boolean }
export const experimentalReadyPolicy: ReadyPolicy = {
  shouldFinish: (s, messages, pending) => !messages && !pending && s.rules.players.every(id => s.ready[id] === true),
};
export function createGame(sessionId: string, rules: Rules): GameState {
  if (rules.players.length !== 5 || new Set(rules.players).size !== 5 || rules.rounds < 1 || rules.negotiationTimeMs <= 0) throw new Error('Invalid rules');
  return { sessionId, rules: structuredClone(rules), round: 1, phase: 'negotiation', logicalTimeMs: 0, roundStartedMs: 0,
    standings: rules.players.map(agentId => ({ agentId, score: 0, minorityWins: 0 })), ready: {}, votes: {}, usedActions: [], outcome: null };
}
export function scoreVotes(players: string[], votes: Record<string, Color>, scoring: Rules['scoring']): Standing[] {
  if (players.length !== 5 || new Set(players).size !== 5 || Object.keys(votes).length !== 5 || players.some(id => votes[id] !== 'red' && votes[id] !== 'blue')) throw new Error('Five valid votes required');
  const reds = players.filter(id => votes[id] === 'red').length;
  const minority: Color | null = reds === 0 || reds === 5 ? null : reds < 3 ? 'red' : 'blue';
  const count = Math.min(reds, 5 - reds);
  return players.map(agentId => {
    const won = minority !== null && votes[agentId] === minority;
    return { agentId, score: minority === null ? 0 : won ? count === 1 ? scoring.solo : scoring.pair : scoring.majority, minorityWins: won ? 1 : 0 };
  });
}
export function rank(standings: Standing[]): Outcome {
  if (!standings.length) throw new Error('No standings');
  const top = [...standings].sort((a, b) => b.score - a.score || b.minorityWins - a.minorityWins)[0]!;
  const winners = standings.filter(s => s.score === top.score && s.minorityWins === top.minorityWins).map(s => s.agentId);
  return winners.length === 1 ? { kind: 'winner', agentId: winners[0]! } : { kind: 'draw', agentIds: winners };
}
export function reduce(state: GameState, event: DomainEvent): GameState {
  const s = structuredClone(state); s.logicalTimeMs = event.logicalTimeMs;
  switch (event.type) {
    case 'ready_changed': s.ready[event.actorId] = event.ready; break;
    case 'vote_committed': s.votes[event.actorId] = event.color; break;
    case 'action_accepted': s.usedActions.push(event.key); break;
    case 'phase_changed': s.phase = event.phase; break;
    case 'round_started': s.round = event.round; s.phase = 'negotiation'; s.roundStartedMs = event.logicalTimeMs; s.ready = {}; s.votes = {}; break;
    case 'scores_updated': s.standings = s.standings.map(row => { const d = event.deltas.find(d => d.agentId === row.agentId)!; return { ...row, score: row.score + d.score, minorityWins: row.minorityWins + d.minorityWins }; }); break;
    case 'game_ended': s.outcome = event.outcome; s.phase = 'completed'; break;
  }
  return s;
}
export function resolveBatch(state: GameState, batch: Batch, readyPolicy: ReadyPolicy = experimentalReadyPolicy): DomainEvent[] {
  if (!batch.batchId || !Number.isSafeInteger(batch.logicalTimeMs) || batch.logicalTimeMs < state.logicalTimeMs || state.phase === 'completed') throw new Error('Invalid batch');
  const events: DomainEvent[] = []; let working = state;
  const emit = (data: EventData) => { const event = { ...data, logicalTimeMs: batch.logicalTimeMs, batchId: batch.batchId }; events.push(event); working = reduce(working, event); };
  const deadline = state.roundStartedMs + state.rules.negotiationTimeMs;
  if (state.phase === 'negotiation' && batch.logicalTimeMs >= deadline) {
    if (batch.actions.length) throw new Error('Deadline boundary accepts no negotiation actions');
    emit({ type: 'phase_changed', phase: 'commit' }); return events;
  }
  if (state.phase === 'reveal') {
    if (batch.actions.length) throw new Error('No actions during reveal');
    if (state.round === state.rules.rounds) emit({ type: 'game_ended', outcome: rank(state.standings) });
    else emit({ type: 'round_started', round: state.round + 1 });
    return events;
  }
  let messages = false;
  for (const item of batch.actions) {
    const { actorId } = item; const action = parseAction(item.action);
    if (!state.rules.players.includes(actorId)) throw new Error('Unknown actor');
    if (action.scheduledTimeMs !== batch.logicalTimeMs) throw new Error('Only due actions accepted; scheduler owns future queue');
    const key = JSON.stringify([actorId, action.actionId]);
    if (working.usedActions.includes(key)) throw new Error('Duplicate action');
    if (state.phase === 'commit') {
      if (action.type !== 'vote' || working.votes[actorId] !== undefined) throw new Error('One immutable vote in Commit only');
      emit({ type: 'vote_committed', actorId, color: action.color });
    } else {
      switch (action.type) {
        case 'vote': throw new Error('Voting outside Commit');
        case 'set_ready': emit({ type: 'ready_changed', actorId, ready: action.ready }); break;
        case 'send_public_message': messages = true; emit({ type: 'public_message', actorId, body: action.message }); break;
        case 'send_private_message':
          if (action.recipientId === actorId || !state.rules.players.includes(action.recipientId)) throw new Error('Invalid recipient');
          messages = true; emit({ type: 'private_message_sent', actorId, recipientId: action.recipientId, body: action.message }); break;
      }
    }
    emit({ type: 'action_accepted', key });
  }
  if (state.phase === 'negotiation' && readyPolicy.shouldFinish(working, messages, batch.hasPendingMessages)) emit({ type: 'phase_changed', phase: 'commit' });
  if (state.phase === 'commit' && state.rules.players.every(id => working.votes[id] !== undefined)) {
    emit({ type: 'phase_changed', phase: 'reveal' });
    emit({ type: 'votes_revealed', votes: { ...working.votes } });
    emit({ type: 'scores_updated', deltas: scoreVotes(state.rules.players, working.votes, state.rules.scoring) });
  }
  return events;
}
