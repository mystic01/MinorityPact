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
      CREATE TABLE IF NOT EXISTS session_runtime(session_id TEXT PRIMARY KEY REFERENCES sessions(id), status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decision_records(session_id TEXT NOT NULL REFERENCES sessions(id), decision_id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(session_id,decision_id));
      CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON decision_records BEGIN SELECT RAISE(ABORT,'append-only decisions'); END;
      CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON decision_records BEGIN SELECT RAISE(ABORT,'append-only decisions'); END;
      CREATE TABLE IF NOT EXISTS decision_audit(id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), snapshot_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON decision_audit BEGIN SELECT RAISE(ABORT,'append-only audit'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON decision_audit BEGIN SELECT RAISE(ABORT,'append-only audit'); END;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, config TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, checkpoint TEXT);
      CREATE TABLE IF NOT EXISTS batches(session_id TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,seq));
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append-only events'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append-only events'); END;
      INSERT OR IGNORE INTO migrations VALUES(1);
      INSERT OR IGNORE INTO migrations VALUES(2);
      INSERT OR IGNORE INTO migrations VALUES(3);`);
  }
  close(): void { this.db.close(); }
  setStatus(id: string, status: string): void { this.db.prepare('INSERT INTO session_runtime VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status').run(id, status); }
  getStatus(id: string): string { return String(this.db.prepare('SELECT status FROM session_runtime WHERE session_id=?').get(id)?.status ?? 'idle'); }
  listSessions(): string[] { return this.db.prepare('SELECT id FROM sessions ORDER BY rowid DESC').all().map(row => String(row.id)); }
  recordAudit(sessionId: string, snapshotId: string, record: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO decision_audit(session_id,snapshot_id,record) VALUES(?,?,?)').run(sessionId, snapshotId, JSON.stringify(record));
  }
  readAudit(sessionId: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT record FROM decision_audit WHERE session_id=? ORDER BY id').all(sessionId).map(row => JSON.parse(String(row.record)) as Record<string, unknown>);
  }
  readCompletedDecisions(sessionId: string): SchedulerCheckpoint['pendingDecisions'] {
    return this.db.prepare('SELECT record FROM decision_records WHERE session_id=? ORDER BY rowid').all(sessionId).map(row => JSON.parse(String(row.record)));
  }
  getVersion(id: string): number {
    const row = this.db.prepare('SELECT version FROM sessions WHERE id=?').get(id);
    if (!row) throw new Error('Unknown session');
    return Number(row.version);
  }
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
      // Archive immutable snapshots once, rather than rewriting all history into every checkpoint.
      for (const decision of r.checkpoint.completedDecisions ?? []) {
        const encoded = JSON.stringify(decision);
        const existing = this.db.prepare('SELECT record FROM decision_records WHERE session_id=? AND decision_id=?').get(r.sessionId, decision.decisionId);
        if (existing && existing.record !== encoded) throw new Error('Immutable decision changed');
        this.db.prepare('INSERT OR IGNORE INTO decision_records VALUES(?,?,?)').run(r.sessionId, decision.decisionId, encoded);
      }
      const checkpoint = { ...r.checkpoint, completedDecisions: [] };
      this.db.prepare('INSERT INTO batches VALUES(?,?,?,?)').run(r.sessionId, r.batchId, fingerprint, version);
      this.db.prepare('UPDATE sessions SET version=?,checkpoint=? WHERE id=?').run(version, JSON.stringify(checkpoint), r.sessionId);
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
