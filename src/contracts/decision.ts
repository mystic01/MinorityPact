import type { AgentId, Color, Phase, PublicEvent, Standing } from './public.ts';
export type Action = { actionId: string; scheduledTimeMs: number } & (
  | { type: 'send_public_message'; message: string }
  | { type: 'send_private_message'; recipientId: AgentId; message: string }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'vote'; color: Color }
);
export interface StrategyNote {
  goal: string; plan: string; whyThisAction: string; predictedOutcome: string;
  observedEventIds: string[]; revisionReason?: string;
}
export type WakeEvent = 'private_message_received' | 'public_message_received';
export interface NextWake { atGameTimeMs?: number; onEvents: WakeEvent[] }
export interface DecisionResult { actions: Action[]; nextWake: NextWake; strategyNote: StrategyNote }
export interface DecisionInput {
  sessionId: string; round: number; phase: Phase; logicalTimeMs: number; batchId: string;
  snapshotId: string; agentId: AgentId; rulesVersion: string; publicRules: string;
  standings: Standing[]; history: PublicEvent[];
  privateMessages: { eventId: string; sender: AgentId; recipient: AgentId; body: string }[];
  ownNotes: StrategyNote[]; wakeReasons: string[];
}
export interface AgentController {
  decide(input: Readonly<DecisionInput>, signal: AbortSignal): Promise<DecisionResult>;
}
