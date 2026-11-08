// Browser-safe contracts: no imports from domain or storage.
export type AgentId = string;
export type Color = 'red' | 'blue';
export type Phase = 'negotiation' | 'commit' | 'reveal' | 'completed';
export interface Standing { agentId: AgentId; score: number; minorityWins: number }
export type Outcome = { kind: 'winner'; agentId: AgentId } | { kind: 'draw'; agentIds: AgentId[] };
export interface PublicView {
  sessionId: string; round: number; phase: Phase; logicalTimeMs: number;
  standings: Standing[]; model: { provider: 'openrouter'; model: string; displayName?: string };
}
export interface PublicEvent {
  eventId: string; batchId: string; commitSeq: number; logicalTimeMs: number;
  type: string; publicPayload: Readonly<Record<string, unknown>>;
}
