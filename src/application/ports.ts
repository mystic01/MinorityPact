import type { DomainEvent } from '../domain/engine.ts';
import type { DecisionInput, DecisionResult, NextWake } from '../contracts/decision.ts';
export interface DecisionSnapshot { snapshotId: string; input: DecisionInput }
export interface SchedulerCheckpoint {
  initialized?: boolean;
  wakeQueue?: Record<string, number>;
  completedDecisions?: SchedulerCheckpoint['pendingDecisions'];
  logicalTimeMs: number;
  subscriptions: Record<string, NextWake>;
  pendingDecisions: { decisionId: string; snapshot: DecisionSnapshot; result?: DecisionResult }[];
  pendingActions: { actorId: string; decisionId: string; action: DecisionResult['actions'][number] }[];
}
export interface StoredEvent {
  eventId: string; sessionId: string; round: number; phase: string; schemaVersion: 1;
  batchId: string; commitSeq: number; logicalTimeMs: number;
  data: DomainEvent; decisionId?: string;
}
export interface CommitRequest {
  sessionId: string; expectedVersion: number; batchId: string;
  events: StoredEvent[]; checkpoint: SchedulerCheckpoint;
}
export type CommitResult = { kind: 'committed' | 'already_committed'; version: number } | { kind: 'version_conflict'; actualVersion: number };
export interface EventStore {
  commitBatch(request: CommitRequest): Promise<CommitResult>;
  readEvents(sessionId: string, afterSeq: number): Promise<StoredEvent[]>;
  loadCheckpoint(sessionId: string): Promise<SchedulerCheckpoint | null>;
}
