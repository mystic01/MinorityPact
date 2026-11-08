import { createGame, reduce } from '../domain/engine.ts';
import { projectEvent, publicView } from './projection.ts';
import type { Viewer } from './projection.ts';
import type { SqliteEventStore } from '../infrastructure/sqlite-store.ts';

// All outward event reads, including catch-up, must pass this service.
export class ReplayService {
  private store: SqliteEventStore;
  constructor(store: SqliteEventStore) { this.store = store; }
  async timeline(sessionId: string) {
    const view = await this.read(sessionId, { kind: 'omniscient' }); // completed gate, even though metadata only
    const all = await this.store.readEvents(sessionId, 0);
    return { lastSeq: view.lastSeq, entries: all.map(e => ({ commitSeq: e.commitSeq, logicalTimeMs: e.logicalTimeMs })) };
  }
  async read(sessionId: string, viewer: Viewer, through = Number.MAX_SAFE_INTEGER, after = 0) {
    if (!Number.isSafeInteger(through) || through < 0 || !Number.isSafeInteger(after) || after < 0 || after > through) throw new Error('Invalid cursor');
    const config = this.store.getConfig(sessionId);
    if (viewer.kind === 'agent' && !config.players.includes(viewer.agentId)) throw new Error('Unknown agent');
    const all = await this.store.readEvents(sessionId, 0);
    const initial = createGame(sessionId, config);
    const final = all.reduce((s, e) => reduce(s, e.data), initial);
    if (viewer.kind === 'omniscient' && final.phase !== 'completed') throw new Error('Replay locked until completed');
    const prefix = all.filter(e => e.commitSeq <= through);
    const state = prefix.reduce((s, e) => reduce(s, e.data), initial);
    return { state: publicView(state, config), lastSeq: prefix.at(-1)?.commitSeq ?? 0,
      events: prefix.filter(e => e.commitSeq > after).map(e => projectEvent(e, viewer)).filter(e => e !== null) };
  }
}
