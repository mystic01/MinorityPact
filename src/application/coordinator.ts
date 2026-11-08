import { createGame, reduce, resolveBatch } from '../domain/engine.ts';
import type { DomainEvent, GameState } from '../domain/engine.ts';
import type { AgentController, DecisionInput, DecisionResult } from '../contracts/decision.ts';
import { parseDecision } from '../contracts/schema.ts';
import type { SessionConfig } from '../domain/config.ts';
import type { SchedulerCheckpoint, StoredEvent } from './ports.ts';
import { SqliteEventStore } from '../infrastructure/sqlite-store.ts';
import { projectEvent } from './projection.ts';
import { alignTime, nextBoundary } from './scheduler.ts';
import { GameClock } from './clock.ts';
import { createHash } from 'node:crypto';

export class DecisionCoordinator {
  private store: SqliteEventStore; private sessionId: string; private controllers: Record<string, AgentController>;
  private busy = false;
  readonly clock: GameClock;
  constructor(store: SqliteEventStore, sessionId: string, controllers: Record<string, AgentController>, clock = new GameClock()) {
    this.store = store; this.sessionId = sessionId; this.controllers = controllers; this.clock = clock;
  }
  private async save(cp: SchedulerCheckpoint, events: DomainEvent[] = []): Promise<void> {
    const version = this.store.getVersion(this.sessionId);
    const old = await this.store.readEvents(this.sessionId, 0);
    let state = old.reduce((s, e) => reduce(s, e.data), createGame(this.sessionId, this.store.getConfig(this.sessionId)));
    const stored = events.map((data, i): StoredEvent => {
      const e = { eventId: `${this.sessionId}:${old.length + i + 1}`, sessionId: this.sessionId, round: state.round, phase: state.phase,
        schemaVersion: 1 as const, batchId: `write:${version}`, logicalTimeMs: data.logicalTimeMs, commitSeq: old.length + i + 1,
        data: { ...data, batchId: `write:${version}` } };
      state = reduce(state, data); return e;
    });
    const result = await this.store.commitBatch({ sessionId: this.sessionId, expectedVersion: version, batchId: `write:${version}`, events: stored, checkpoint: cp });
    if (result.kind === 'version_conflict') throw new Error('Concurrent session writer');
  }
  // pace must wait the requested GAME interval in live mode; tests supply a virtual pacer.
  async step(pace: (milliseconds: number) => Promise<void>, timeoutMs = 60000): Promise<'running' | 'completed'> {
    if (this.busy) throw new Error('Coordinator already running');
    this.busy = true;
    try { return await this.execute(pace, timeoutMs); }
    finally { this.busy = false; }
  }
  private async execute(pace: (milliseconds: number) => Promise<void>, timeoutMs: number): Promise<'running' | 'completed'> {
    const config = this.store.getConfig(this.sessionId);
    let history = await this.store.readEvents(this.sessionId, 0);
    let state = history.reduce((s, e) => reduce(s, e.data), createGame(this.sessionId, config));
    if (state.phase === 'completed') return 'completed';
    let cp: SchedulerCheckpoint = await this.store.loadCheckpoint(this.sessionId) ?? { logicalTimeMs: 0, subscriptions: {}, pendingActions: [], pendingDecisions: [], wakeQueue: {}, completedDecisions: [] };
    const time = nextBoundary(state, cp, config);
    await pace(Math.max(0, time - cp.logicalTimeMs));
    this.clock.seekBoundary(time); this.clock.pause(); cp.logicalTimeMs = time;
    const batchId = `${this.sessionId}:${state.round}:${state.phase}:${time}`;
    const deadline = state.roundStartedMs + config.negotiationTimeMs;
    if (!cp.pendingDecisions.length) {
      if (state.phase === 'reveal' || state.phase === 'negotiation' && time >= deadline) {
        cp.pendingActions = []; cp.subscriptions = {}; cp.wakeQueue = {}; cp.initialized = false;
        await this.save(cp, resolveBatch(state, { batchId, logicalTimeMs: time, actions: [], hasPendingMessages: false }));
        this.clock.resume(); return 'running';
      }
      const due = cp.pendingActions.filter(p => p.action.scheduledTimeMs <= time);
      cp.pendingActions = cp.pendingActions.filter(p => p.action.scheduledTimeMs > time);
      if (due.length) {
        const events = resolveBatch(state, { batchId, logicalTimeMs: time, actions: due, hasPendingMessages: cp.pendingActions.some(p => p.action.type.includes('message')) });
        this.queueWakes(events, cp, config, state);
        await this.save(cp, events); history = await this.store.readEvents(this.sessionId, 0);
        state = history.reduce((s, e) => reduce(s, e.data), createGame(this.sessionId, config));
        if (state.phase !== 'negotiation') { cp.initialized = false; cp.subscriptions = {}; cp.wakeQueue = {}; }
      }
      const order = [...config.players].sort((a, b) => {
        const key = (id: string) => createHash('sha256').update(JSON.stringify([config.seed, batchId, id])).digest('hex');
        return key(a).localeCompare(key(b));
      });
      const actors = order.filter(id => !cp.initialized || state.phase === 'commit' && !state.votes[id] || (cp.subscriptions[id]?.atGameTimeMs ?? Infinity) <= time || (cp.wakeQueue?.[id] ?? Infinity) <= time);
      cp.pendingDecisions = actors.map(agentId => {
        delete cp.wakeQueue?.[agentId];
        if (cp.subscriptions[agentId]) delete cp.subscriptions[agentId]!.atGameTimeMs;
        const visible = history.map(e => projectEvent(e, { kind: 'agent', agentId })).filter(e => e !== null);
        const snapshotId = `${batchId}:${agentId}:${history.length}`;
        const input: DecisionInput = { sessionId: this.sessionId, round: state.round, phase: state.phase, logicalTimeMs: time, batchId, snapshotId, agentId,
          rulesVersion: config.rulesVersion, publicRules: JSON.stringify({ objective: 'unique final champion; second place has no victory value', ranking: ['total_score_desc', 'minority_wins_desc', 'draw'], players: config.players, rounds: config.rounds, scoring: config.scoring, negotiationTimeMs: config.negotiationTimeMs, policies: config.policies, scheduling: config.scheduling }),
          standings: structuredClone(state.standings), history: visible,
          privateMessages: history.flatMap(e => e.data.type === 'private_message_sent' && [e.data.actorId, e.data.recipientId].includes(agentId) ? [{ eventId: e.eventId, sender: e.data.actorId, recipient: e.data.recipientId, body: e.data.body }] : []),
          ownNotes: history.flatMap(e => e.data.type === 'strategy_note' && e.data.actorId === agentId ? [e.data.note] : []), wakeReasons: [cp.initialized ? 'scheduled' : 'phase_started'] };
        return { decisionId: snapshotId, snapshot: { snapshotId, input } };
      });
      cp.initialized = true; await this.save(cp);
    }
    // All requests use persisted snapshots; completion order never changes application order.
    let writes = Promise.resolve();
    const settled = await Promise.allSettled(cp.pendingDecisions.map(async pending => {
      if (pending.result) return;
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const signal = AbortSignal.timeout(timeoutMs);
          const raw = await Promise.race([this.controllers[pending.snapshot.input.agentId]!.decide(structuredClone(pending.snapshot.input), signal), new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Decision timeout')), { once: true }))]);
          const result = parseDecision(raw); this.validate(result, pending.snapshot.input, state, config);
          pending.result = result;
          writes = writes.then(() => this.save(cp)); await writes; return;
        } catch (error) { last = error; }
      }
      throw last;
    }));
    await writes;
    if (settled.some(r => r.status === 'rejected')) throw new Error('paused_error: decision failed; resume same snapshots');
    const events: DomainEvent[] = [];
    for (const p of cp.pendingDecisions) {
      const result = p.result!; const actorId = p.snapshot.input.agentId;
      events.push({ type: 'strategy_note', actorId, note: result.strategyNote, batchId, logicalTimeMs: time });
      cp.subscriptions[actorId] = structuredClone(result.nextWake);
      if (cp.subscriptions[actorId]!.atGameTimeMs !== undefined) cp.subscriptions[actorId]!.atGameTimeMs = alignTime(cp.subscriptions[actorId]!.atGameTimeMs!, config, state.roundStartedMs);
      for (const action of result.actions) cp.pendingActions.push({ actorId, decisionId: p.decisionId, action: { ...action, actionId: `${p.decisionId}/${action.actionId}`, scheduledTimeMs: alignTime(action.scheduledTimeMs, config, state.roundStartedMs) } });
    }
    const immediate = cp.pendingActions.filter(p => p.action.scheduledTimeMs === time);
    cp.pendingActions = cp.pendingActions.filter(p => p.action.scheduledTimeMs > time);
    const resolved = resolveBatch(state, { batchId, logicalTimeMs: time, actions: immediate, hasPendingMessages: cp.pendingActions.some(p => p.action.type.includes('message')) });
    events.push(...resolved); this.queueWakes(resolved, cp, config, state);
    if (resolved.some(e => e.type === 'phase_changed')) { cp.initialized = false; cp.pendingActions = []; cp.subscriptions = {}; cp.wakeQueue = {}; }
    cp.completedDecisions = [...(cp.completedDecisions ?? []), ...cp.pendingDecisions]; cp.pendingDecisions = [];
    await this.save(cp, events); this.clock.resume(); return 'running';
  }
  private queueWakes(events: DomainEvent[], cp: SchedulerCheckpoint, c: SessionConfig, state: GameState): void {
    cp.wakeQueue ??= {};
    for (const e of events) for (const id of c.players) {
      const kind = e.type === 'private_message_sent' && e.recipientId === id ? 'private_message_received' : e.type === 'public_message' && e.actorId !== id ? 'public_message_received' : null;
      if (kind && cp.subscriptions[id]?.onEvents.includes(kind)) cp.wakeQueue[id] = Math.min(cp.wakeQueue[id] ?? Infinity, alignTime(cp.logicalTimeMs + c.scheduling.eventReactionMs, c, state.roundStartedMs));
    }
  }
  private validate(r: DecisionResult, input: DecisionInput, s: GameState, c: SessionConfig): void {
    const known = new Set(input.history.map(e => e.eventId));
    if (r.strategyNote.observedEventIds.some(id => !known.has(id))) throw new Error('Unknown observed event');
    const previous = input.ownNotes.at(-1);
    if (previous && previous.goal !== r.strategyNote.goal && !r.strategyNote.revisionReason) throw new Error('Goal change needs reason');
    if (r.nextWake.atGameTimeMs !== undefined && r.nextWake.atGameTimeMs <= input.logicalTimeMs) throw new Error('Wake must be in future');
    if (s.phase === 'commit' && (r.actions.length !== 1 || r.actions[0]!.type !== 'vote')) throw new Error('Commit requires one vote');
    for (const a of r.actions) {
      if (a.scheduledTimeMs < input.logicalTimeMs || s.phase === 'commit' && a.scheduledTimeMs !== input.logicalTimeMs) throw new Error('Invalid action time');
      if (s.phase === 'negotiation' && (a.type === 'vote' || alignTime(a.scheduledTimeMs, c, s.roundStartedMs) >= s.roundStartedMs + c.negotiationTimeMs)) throw new Error('Action outside negotiation');
      if (a.type === 'send_private_message' && (a.recipientId === input.agentId || !c.players.includes(a.recipientId))) throw new Error('Invalid recipient');
    }
  }
}
