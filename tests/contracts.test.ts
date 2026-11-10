import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reduce, resolveBatch, rank } from '../src/domain/engine.ts';
import type { GameState } from '../src/domain/engine.ts';
import type { Action } from '../src/contracts/decision.ts';
import { parseConfig } from '../src/domain/config.ts';
import { readFileSync } from 'node:fs';
import { projectEvent } from '../src/application/projection.ts';
import { contractPrompt, decisionSchemaFor } from '../src/controllers/prompt.ts';
import { parseAction } from '../src/contracts/schema.ts';
import { settlePayments } from '../src/domain/payments.ts';
import type { PaymentContract } from '../src/contracts/payment.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { ReplayService } from '../src/application/replay.ts';
import type { DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const config = () => parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
function game() { return createGame('contracts', config()); }
let batch = 0;
function apply(s: GameState, actions: { actorId: string; action: Action }[], time = 0) {
  const events = resolveBatch(s, { batchId: `test-${++batch}`, logicalTimeMs: time, actions, hasPendingMessages: false });
  return { state: events.reduce(reduce, s), events };
}
const proposal = (id: string, recipientId: string, amount = 2, condition: PaymentContract['condition'] = 'recipient_blue'): Action => ({ type: 'propose_contract', actionId: id, scheduledTimeMs: 0, recipientId, amount, condition });
const accept = (id: string, contractId: string): Action => ({ type: 'accept_contract', actionId: id, scheduledTimeMs: 0, contractId });
const cancel = (id: string, contractId: string): Action => ({ type: 'cancel_contract', actionId: id, scheduledTimeMs: 0, contractId });

test('two-party proposals require recipient acceptance, permit multiple contracts and do not reserve funds', () => {
  let s = game();
  s = apply(s, [{ actorId: 'A', action: proposal('ab', 'B', Number.MAX_SAFE_INTEGER) }, { actorId: 'A', action: proposal('ac', 'C') }, { actorId: 'A', action: proposal('ab2', 'B') }]).state;
  assert.equal(s.contracts.length, 3); assert.equal(s.standings[0]!.score, 0);
  let result = apply(s, [{ actorId: 'D', action: accept('forged', 'ab') }, { actorId: 'A', action: accept('self', 'ac') }]);
  assert.equal(result.events.filter(e => e.type === 'contract_rejected').length, 2);
  result = apply(result.state, [{ actorId: 'B', action: accept('valid', 'ab') }]);
  assert.equal(result.state.contracts[0]!.status, 'active');
  assert.ok(result.events.some(e => e.type === 'contract_updated' && e.notice === '契約成立'));
  assert.throws(() => parseAction({ ...proposal('zero', 'B'), amount: 0 }));
  assert.throws(() => apply(s, [{ actorId: 'A', action: proposal('self', 'A') }]));
});

test('mutual cancellation is required; unilateral request stays binding; no same-batch acceptance', () => {
  let s = apply(game(), [{ actorId: 'A', action: proposal('ab', 'B') }, { actorId: 'B', action: accept('too-early', 'ab') }]).state;
  assert.equal(s.contracts[0]!.status, 'proposed');
  s = apply(s, [{ actorId: 'B', action: accept('ok', 'ab') }]).state;
  s = apply(s, [{ actorId: 'A', action: cancel('request', 'ab') }]).state;
  assert.equal(s.contracts[0]!.status, 'active');
  s = apply(s, [{ actorId: 'B', action: cancel('agree', 'ab') }]).state;
  assert.equal(s.contracts[0]!.status, 'cancelled');
  assert.equal(settlePayments(s.contracts, { A: 'red', B: 'blue' }, s.standings, s.standings).length, 0);
});

function c(id: string, payer: string, recipient: string, amount: number, condition: PaymentContract['condition'] = 'recipient_blue'): PaymentContract {
  return { id, round: 1, payer, recipient, amount, condition, status: 'active', cancelApprovals: [] };
}
test('per-payer total uses only triggered contracts; insufficient total pays nobody; equality pays both', () => {
  const s = game().standings, awards = s.map(x => ({ ...x, score: x.agentId === 'A' ? 3 : 0 }));
  const contracts = [c('ab', 'A', 'B', 2), c('ac', 'A', 'C', 2), c('ad', 'A', 'D', 100, 'recipient_red')];
  const votes = { A: 'red' as const, B: 'blue' as const, C: 'blue' as const, D: 'blue' as const };
  let results = settlePayments(contracts, votes, s, awards);
  assert.deepEqual(results.map(r => r.paid), [0, 0, 0]);
  assert.deepEqual(results.map(r => r.reason), ['付款人支付能力不足', '付款人支付能力不足', '條件未觸發']);
  const funded = s.map(x => ({ ...x, score: x.agentId === 'A' ? 1 : 0 }));
  results = settlePayments(contracts, votes, funded, awards);
  assert.deepEqual(results.map(r => r.paid), [2, 2, 0]);
});

test('incoming transfers never fund outgoing obligations and one insolvent payer does not block another', () => {
  const s = game().standings.map(x => ({ ...x, score: x.agentId === 'A' ? 3 : x.agentId === 'B' ? 5 : 0 }));
  const awards = game().standings;
  const contracts = [c('ba', 'B', 'A', 2, 'same_color'), c('ac', 'A', 'C', 4, 'same_color')];
  for (const cs of [contracts, [...contracts].reverse()]) {
    const result = settlePayments(cs, { A: 'red', B: 'red', C: 'red' }, s, awards);
    assert.equal(result.find(r => r.contract.id === 'ba')!.paid, 2);
    assert.equal(result.find(r => r.contract.id === 'ac')!.paid, 0);
  }
});

test('all fixed conditions use actual votes and original minority award, never transfers', () => {
  const s = game().standings;
  const contracts = [c('red', 'A', 'B', 1, 'recipient_red'), c('blue', 'A', 'B', 1), c('same', 'A', 'B', 1, 'same_color'), c('diff', 'A', 'B', 1, 'different_color'), c('profit', 'A', 'B', 1, 'payer_minority')];
  for (const score of [2, 5]) {
    const results = settlePayments(contracts, { A: 'red', B: 'blue' }, s.map(x => ({ ...x, score: 20 })), s.map(x => ({ ...x, score: x.agentId === 'A' ? score : 0, minorityWins: x.agentId === 'A' ? 1 : 0 })));
    assert.deepEqual(results.map(r => r.paid), [0, 1, 0, 1, 1]);
  }
});

test('settlement changes ranking, preserves win counts, expires contracts and replays identically', () => {
  const initial = game(); let s = initial; const all = [];
  for (const actions of [[{ actorId: 'A', action: proposal('ab', 'B', 2, 'payer_minority') }], [{ actorId: 'B', action: accept('ok', 'ab') }]]) {
    const r = apply(s, actions); s = r.state; all.push(...r.events);
  }
  let r = apply(s, [], s.rules.negotiationTimeMs); s = r.state; all.push(...r.events);
  const actions = s.rules.players.map(actorId => ({ actorId, action: { type: 'vote' as const, actionId: 'v', scheduledTimeMs: s.logicalTimeMs, color: actorId === 'A' || actorId === 'C' ? 'red' as const : 'blue' as const } }));
  r = apply(s, actions, s.logicalTimeMs); s = r.state; all.push(...r.events);
  assert.deepEqual(s.standings.map(x => x.score), [0, 2, 2, 0, 0]);
  assert.deepEqual(s.standings.map(x => x.minorityWins), [1, 0, 1, 0, 0]);
  assert.deepEqual(rank(s.standings), { kind: 'winner', agentId: 'C' });
  assert.deepEqual(all.reduce(reduce, initial), s);
  assert.equal(apply(s, [], s.logicalTimeMs).state.contracts.length, 0);
  assert.throws(() => apply(s, [{ actorId: 'B', action: accept('late', 'ab') }], s.logicalTimeMs));
});

test('contract terms and notices are only projected to the two parties; prompts never disclose settlement threshold', () => {
  const result = apply(game(), [{ actorId: 'A', action: proposal('secret', 'B') }]);
  const data = result.events.find(e => e.type === 'contract_updated')!;
  const event = { eventId: 'e', sessionId: 's', round: 1, phase: 'negotiation', schemaVersion: 1 as const, batchId: data.batchId, commitSeq: 1, logicalTimeMs: 0, data };
  assert.ok(projectEvent(event, { kind: 'agent', agentId: 'A' }));
  assert.ok(projectEvent(event, { kind: 'agent', agentId: 'B' }));
  assert.equal(projectEvent(event, { kind: 'agent', agentId: 'C' }), null);
  assert.equal(projectEvent(event, { kind: 'spectator' }), null);
  assert.ok(projectEvent(event, { kind: 'omniscient' }));
  const input = { publicRules: JSON.stringify({ contractsEnabled: true }), phase: 'negotiation', logicalTimeMs: 0 };
  assert.match(JSON.stringify(decisionSchemaFor(input)), /propose_contract/);
  assert.doesNotMatch(contractPrompt(input), /不足|歸零|全部不|支付能力/);
  assert.equal(contractPrompt({ publicRules: '{}' }), '');
  assert.doesNotMatch(JSON.stringify(decisionSchemaFor({ ...input, publicRules: '{}' })), /propose_contract/);
  assert.throws(() => apply(createGame('legacy', { ...config(), contractsEnabled: false }), [{ actorId: 'A', action: proposal('no', 'B') }]));
});

test('coordinator wakes signers without subscriptions, resumes accepted contracts from disk and settles a five-round offline game', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pact-contracts-'));
  const path = join(dir, 'game.sqlite'); let store = new SqliteEventStore(path);
  const cfg = config(); cfg.rounds = 5; cfg.scheduling.reconsiderAfterMs = 15000;
  store.createSession('s', cfg);
  const controllers = Object.fromEntries(cfg.players.map(id => [id, { decide: async (input: DecisionInput): Promise<DecisionResult> => {
    const actions: Action[] = [];
    if (input.phase === 'commit') actions.push({ type: 'vote', actionId: 'v', scheduledTimeMs: input.logicalTimeMs, color: ['A', 'D'].includes(id) ? 'red' : 'blue' });
    else {
      const own = new Map<string, PaymentContract>();
      for (const e of input.history) if (e.type === 'contract_updated') { const c = e.publicPayload.contract as PaymentContract; if (c.round === input.round) own.set(c.id, c); }
      if (id === 'A' && !own.size) for (const recipient of ['B', 'C']) actions.push({ ...proposal(`pay-${recipient}`, recipient), scheduledTimeMs: input.logicalTimeMs });
      for (const c of own.values()) if (c.recipient === id && c.status === 'proposed') actions.push({ ...accept('yes', c.id), scheduledTimeMs: input.logicalTimeMs });
    }
    return { actions, nextWake: { onEvents: [] }, strategyNote: { goal: 'test', plan: 'test', whyThisAction: 'test', predictedOutcome: 'test', observedEventIds: [] } };
  } }]));
  try {
    let coordinator = new DecisionCoordinator(store, 's', controllers);
    await coordinator.step(async () => {}); await coordinator.step(async () => {});
    let events = await store.readEvents('s', 0);
    assert.equal(events.filter(e => e.data.type === 'contract_updated' && e.data.contract.status === 'active').length, 2);
    assert.equal((await store.loadCheckpoint('s'))!.logicalTimeMs, 5000);
    store.close(); store = new SqliteEventStore(path); coordinator = new DecisionCoordinator(store, 's', controllers);
    let finished = false;
    for (let n = 0; n < 100; n++) if (await coordinator.step(async () => {}) === 'completed') { finished = true; break; }
    assert.ok(finished);
    events = await store.readEvents('s', 0);
    const settlements = events.filter(e => e.data.type === 'contract_settled');
    assert.equal(settlements.length, 10);
    assert.ok(settlements.filter(e => e.round === 1).every(e => e.data.type === 'contract_settled' && e.data.reason === '付款人支付能力不足' && e.data.paid === 0));
    assert.ok(settlements.filter(e => e.round === 2).every(e => e.data.type === 'contract_settled' && e.data.paid === 2));
    const replay = new ReplayService(store);
    assert.ok(!(await replay.read('s', { kind: 'spectator' })).events.some(e => e.type.startsWith('contract_')));
    assert.ok((await replay.read('s', { kind: 'omniscient' })).events.some(e => e.type === 'contract_settled'));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
