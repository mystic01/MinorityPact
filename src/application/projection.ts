import type { StoredEvent } from './ports.ts';
import type { PublicEvent, PublicView } from '../contracts/public.ts';
import type { GameState } from '../domain/engine.ts';
import type { SessionConfig } from '../domain/config.ts';

export type Viewer = { kind: 'spectator' } | { kind: 'agent'; agentId: string } | { kind: 'omniscient' };
// Identity is supplied by trusted server/controller wiring, never a raw query parameter.
export function projectEvent(e: StoredEvent, viewer: Viewer): PublicEvent | null {
  const d = e.data; let payload: Record<string, unknown>;
  switch (d.type) {
    case 'public_message': payload = { sender: d.actorId, body: d.body }; break;
    case 'private_message_sent':
      payload = { sender: d.actorId, recipient: d.recipientId };
      if (viewer.kind === 'omniscient' || viewer.kind === 'agent' && [d.actorId, d.recipientId].includes(viewer.agentId)) payload.body = d.body;
      break;
    case 'strategy_note':
      if (viewer.kind !== 'omniscient' && !(viewer.kind === 'agent' && viewer.agentId === d.actorId)) return null;
      payload = { actorId: d.actorId, note: structuredClone(d.note) }; break;
    case 'vote_committed':
      if (viewer.kind !== 'omniscient' && !(viewer.kind === 'agent' && viewer.agentId === d.actorId)) return null;
      payload = { actorId: d.actorId, color: d.color }; break;
    case 'ready_changed':
      if (viewer.kind !== 'omniscient' && !(viewer.kind === 'agent' && viewer.agentId === d.actorId)) return null;
      payload = { actorId: d.actorId, ready: d.ready }; break;
    case 'action_accepted': return null;
    case 'phase_changed': payload = { phase: d.phase }; break;
    case 'round_started': payload = { round: d.round }; break;
    case 'votes_revealed': payload = { votes: { ...d.votes } }; break;
    case 'scores_updated': payload = { deltas: structuredClone(d.deltas) }; break;
    case 'game_ended': payload = { outcome: structuredClone(d.outcome) }; break;
    default: return null;
  }
  return { eventId: e.eventId, batchId: e.batchId, commitSeq: e.commitSeq, logicalTimeMs: e.logicalTimeMs, type: d.type, publicPayload: payload };
}
export function publicView(state: GameState, config: SessionConfig): PublicView {
  return { sessionId: state.sessionId, round: state.round, phase: state.phase, logicalTimeMs: state.logicalTimeMs,
    rounds: config.rounds, negotiationTimeMs: config.negotiationTimeMs, roundStartedMs: state.roundStartedMs,
    ...(config.seatModels ? { seatModels: structuredClone(config.seatModels) } : {}),
    standings: structuredClone(state.standings), model: { provider: config.llm.provider, model: config.llm.model,
      ...(config.llm.displayName === undefined ? {} : { displayName: config.llm.displayName }) } };
}
