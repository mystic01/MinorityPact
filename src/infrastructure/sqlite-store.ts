import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { parseConfig } from '../domain/config.ts';
import type { SessionConfig } from '../domain/config.ts';
import type { CommitRequest, CommitResult, EventStore, SchedulerCheckpoint, StoredEvent } from '../application/ports.ts';

// Trusted server-side adapter. Never expose this object to controllers or HTTP clients.
export class SqliteEventStore implements EventStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, checkpoint TEXT);
      CREATE TABLE IF NOT EXISTS batches(session_id TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append-only events'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append-only events'); END;
      INSERT OR IGNORE INTO migrations VALUES(1);`);
  }
  close(): void { this.db.close(); }
  createSession(id: string, config: SessionConfig): void {
    if (!id.trim()) throw new Error('Invalid session ID');
    const validated = parseConfig(config);
    this.db.prepare('INSERT INTO sessions(id,config) VALUES(?,?)').run(id, JSON.stringify(validated));
  }
  getConfig(id: string): SessionConfig {
    const row = this.db.prepare('SELECT config FROM sessions WHERE id=?').get(id);
    if (!row) throw new Error('Unknown session');
    return parseConfig(JSON.parse(String(row.config)));
  }
  async commitBatch(request: CommitRequest): Promise<CommitResult> {
    const r = structuredClone(request);
    if (!r.batchId || !Number.isSafeInteger(r.expectedVersion) || r.expectedVersion < 0) throw new Error('Invalid commit');
    const fingerprint = createHash('sha256').update(JSON.stringify(r)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const session = this.db.prepare('SELECT version,checkpoint FROM sessions WHERE id=?').get(r.sessionId);
      if (!session) throw new Error('Unknown session');
      const old = this.db.prepare('SELECT fingerprint,version FROM batches WHERE session_id=? AND id=?').get(r.sessionId, r.batchId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('Batch ID reused with different content');
        this.db.exec('COMMIT'); return { kind: 'already_committed', version: Number(old.version) };
      }
      if (Number(session.version) !== r.expectedVersion) {
        this.db.exec('ROLLBACK'); return { kind: 'version_conflict', actualVersion: Number(session.version) };
      }
      const previousTime = session.checkpoint ? (JSON.parse(String(session.checkpoint)) as SchedulerCheckpoint).logicalTimeMs : 0;
      if (!Number.isSafeInteger(r.checkpoint.logicalTimeMs) || r.checkpoint.logicalTimeMs < previousTime) throw new Error('Clock regressed');
      const row = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session_id=?').get(r.sessionId)!;
      let seq = Number(row.seq); let time = previousTime;
      for (const e of r.events) {
        if (e.sessionId !== r.sessionId || e.batchId !== r.batchId || e.data.batchId !== r.batchId || e.schemaVersion !== 1 || e.commitSeq !== ++seq || !e.eventId || !Number.isSafeInteger(e.logicalTimeMs) || e.logicalTimeMs < time || e.logicalTimeMs > r.checkpoint.logicalTimeMs || e.data.logicalTimeMs !== e.logicalTimeMs) throw new Error('Invalid event envelope');
        time = e.logicalTimeMs;
        this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(r.sessionId, e.commitSeq, e.eventId, r.batchId, JSON.stringify(e));
      }
      const version = r.expectedVersion + 1;
      this.db.prepare('INSERT INTO batches VALUES(?,?,?,?)').run(r.sessionId, r.batchId, fingerprint, version);
      this.db.prepare('UPDATE sessions SET version=?,checkpoint=? WHERE id=?').run(version, JSON.stringify(r.checkpoint), r.sessionId);
      this.db.exec('COMMIT'); return { kind: 'committed', version };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async readEvents(sessionId: string, afterSeq: number): Promise<StoredEvent[]> {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('Invalid cursor');
    return this.db.prepare('SELECT data FROM events WHERE session_id=? AND seq>? ORDER BY seq').all(sessionId, afterSeq).map(row => JSON.parse(String(row.data)) as StoredEvent);
  }
  async loadCheckpoint(sessionId: string): Promise<SchedulerCheckpoint | null> {
    const row = this.db.prepare('SELECT checkpoint FROM sessions WHERE id=?').get(sessionId);
    if (!row) throw new Error('Unknown session');
    return row.checkpoint ? JSON.parse(String(row.checkpoint)) as SchedulerCheckpoint : null;
  }
}
