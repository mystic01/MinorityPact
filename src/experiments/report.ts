import { createHash } from 'node:crypto';
import { createGame, reduce } from '../domain/engine.ts';
import type { SessionConfig } from '../domain/config.ts';
import type { SqliteEventStore } from '../infrastructure/sqlite-store.ts';
export function experimentMatrix(base: SessionConfig): SessionConfig[] {
  return [10, 12].flatMap(rounds => (['fixed_5s', 'fixed_15s', 'event_driven'] as const).flatMap(mode => (['exclusive', 'zero_sum'] as const).map(policy => ({
    ...structuredClone(base), rounds, scheduling: { ...base.scheduling, mode },
    scoring: policy === 'exclusive' ? { policy, solo: 5, pair: 2, majority: 0 } : { policy, solo: 8, pair: 3, majority: -2 },
  }))));
}
export async function summarize(store: SqliteEventStore, sessionId: string) {
  const config = store.getConfig(sessionId); const events = await store.readEvents(sessionId, 0);
  const state = events.reduce((s, e) => reduce(s, e.data), createGame(sessionId, config));
  const audits = store.readAudit(sessionId);
  const responses = audits.filter(a => a.kind === 'provider_response');
  const usage = { promptTokens: 0, completionTokens: 0, reportedCost: 0 };
  for (const a of responses) {
    try {
      const r = JSON.parse(String(a.rawResponse));
      usage.promptTokens += Number(r.usage?.prompt_tokens ?? 0); usage.completionTokens += Number(r.usage?.completion_tokens ?? 0); usage.reportedCost += Number(r.usage?.cost ?? 0);
    } catch { /* HTTP errors need not contain JSON or token usage. */ }
  }
  return { sessionId, source: responses.length ? 'provider_responses' : 'scripted_or_imported',
    complete: state.phase === 'completed', round: state.round, configuredRounds: config.rounds,
    models: config.seatModels ?? Object.fromEntries(config.players.map(id => [id, { model: config.llm.model }])),
    scoring: config.scoring, scheduling: config.scheduling, negotiationTimeMs: config.negotiationTimeMs, seed: config.seed,
    eventCount: events.length, eventHash: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
    publicMessages: events.filter(e => e.data.type === 'public_message').length,
    privateMessages: events.filter(e => e.data.type === 'private_message_sent').length,
    strategyNotes: events.filter(e => e.data.type === 'strategy_note').length,
    revealedRounds: events.filter(e => e.data.type === 'votes_revealed').length,
    standings: state.standings, outcome: state.outcome,
    providerAttempts: responses.length, providerFailures: responses.filter(r => !r.success).length,
    validationFailures: audits.filter(a => a.kind === 'decision_rejected').length,
    usage, interpretation: 'Metrics only. No claim of strategic quality, causal persuasion, or verified foresight. Raw data stays private.' };
}
