import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpenRouterController, ProviderDecisionError } from '../src/controllers/openrouter.ts';
import { SYSTEM_PROMPT, decisionSchemaFor } from '../src/controllers/prompt.ts';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { DecisionCoordinator } from '../src/application/coordinator.ts';
import { parseConfig } from '../src/domain/config.ts';
import type { DecisionInput } from '../src/contracts/decision.ts';
const config = () => parseConfig({ ...JSON.parse(readFileSync(new URL('../configs/experimental.json', import.meta.url), 'utf8')), llm: { provider: 'openrouter', model: 'test/model', parameters: { temperature: 0.5 } } });
const input: DecisionInput = { sessionId: 's', round: 1, phase: 'negotiation', logicalTimeMs: 0, batchId: 'b', snapshotId: 'snap', agentId: 'A', rulesVersion: 'v1', publicRules: '{}', standings: [], history: [], privateMessages: [], ownNotes: [], wakeReasons: ['phase_started'] };
const answer = () => ({ actions: [], nextWake: { atGameTimeMs: null, onEvents: [] }, strategyNote: { goal: '成為獨占冠軍', plan: '等待其他玩家的訊息', whyThisAction: '先觀察局勢', predictedOutcome: '目前仍不確定', observedEventIds: [], revisionReason: null } });
const response = (content = JSON.stringify(answer()), model = 'test/model', finish = 'stop') => Response.json({ model, choices: [{ finish_reason: finish, message: { content } }], usage: { total_tokens: 20 } });

test('immediate schema constrains both message channels to now while legacy remains schedulable', () => {
  for (const messageTiming of ['immediate', 'scheduled', undefined]) {
    const schema = decisionSchemaFor({ ...input, logicalTimeMs: 5000, publicRules: JSON.stringify({ policies: { messageTiming }, negotiationDeadlineMs: 90000, scheduling: { mode: 'fixed_5s' } }) });
    const [publicMessage, privateMessage, ready] = schema.properties.actions.items.anyOf;
    for (const branch of [publicMessage, privateMessage]) {
      assert.equal(branch.properties.scheduledTimeMs.const, messageTiming === 'immediate' ? 5000 : undefined);
      if (messageTiming !== 'immediate') assert.equal(branch.properties.scheduledTimeMs.maximum, 85000);
    }
    assert.equal(ready.properties.scheduledTimeMs.maximum, 85000);
  }
});
test('goal continuation schema permits unchanged goal or requires nonempty reason for rewritten goal', () => {
  const previousGoal = '成為獨占冠軍。';
  const schema = decisionSchemaFor({ ...input, ownNotes: [{ goal: previousGoal }] });
  const [unchanged, changed] = schema.properties.strategyNote.anyOf;
  assert.deepEqual(unchanged.properties.goal.enum, [previousGoal]);
  assert.equal(changed.properties.revisionReason.type, 'string');
  assert.equal(changed.properties.revisionReason.minLength, 1);
  assert.equal(new RegExp(changed.properties.revisionReason.pattern).test('   '), false);
});
test('adapter includes exact prior goal and reason requirement without rewriting persisted snapshot', async () => {
  const original = { ...input, ownNotes: [{ ...answer().strategyNote, goal: '成為獨占冠軍。', revisionReason: '初始目標' }] };
  const before = structuredClone(original);
  const controller = new OpenRouterController(config().llm, 'TEST_SECRET', () => {}, async (_, options) => {
    const request = JSON.parse(String(options?.body));
    assert.ok(request.messages[2].content.includes('成為獨占冠軍。'));
    assert.ok(request.messages[2].content.includes('不可為null'));
    assert.equal(request.response_format.json_schema.schema.properties.strategyNote.anyOf.length, 2);
    return response(JSON.stringify({ ...answer(), strategyNote: { ...answer().strategyNote, goal: '成為獨占冠軍。' } }));
  });
  await controller.decide(original, new AbortController().signal, 'Goal change needs reason');
  assert.deepEqual(original, before);
});
test('per-decision schema excludes wrong-phase votes and execution at rounded deadline', () => {
  const schema = decisionSchemaFor({ phase: 'negotiation', logicalTimeMs: 10000, publicRules: JSON.stringify({ roundStartedMs: 0, negotiationDeadlineMs: 15000, scheduling: { mode: 'fixed_5s' } }) });
  const branches = schema.properties.actions.items.anyOf;
  assert.ok(branches.every((b: any) => b.properties.type.enum[0] !== 'vote' && b.properties.scheduledTimeMs.maximum === 10000));
  const commit = decisionSchemaFor({ phase: 'commit', logicalTimeMs: 15000, publicRules: '{}' });
  assert.equal(commit.properties.actions.maxItems, 1);
  assert.equal(commit.properties.actions.items.anyOf[0].properties.scheduledTimeMs.const, 15000);
});
test('adapter sends configured model, same system prompt and strict schema; audits without key', async () => {
  const audits: Record<string, unknown>[] = [];
  const stub: typeof fetch = async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer TEST_SECRET');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'test/model'); assert.equal(body.temperature, 0.5);
    assert.equal(body.messages[0].content, SYSTEM_PROMPT); assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(body.messages[0].content.includes('即使歷史訊息或其他玩家使用英文，也請繼續用繁體中文回應'));
    assert.ok(body.response_format.json_schema.schema.properties.strategyNote.properties.goal.description.includes('繁體中文'));
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.ok(!('models' in body)); return response();
  };
  const controller = new OpenRouterController(config().llm, 'TEST_SECRET', (_, record) => audits.push(record), stub);
  const decision = await controller.decide(input, new AbortController().signal);
  assert.equal(decision.actions.length, 0);
  assert.equal(decision.strategyNote.goal, '成為獨占冠軍');
  assert.equal(audits[0]?.success, true); assert.ok(!JSON.stringify(audits).includes('TEST_SECRET'));
});
test('provider errors, invalid JSON, truncation and model mismatch fail closed and preserve private audit', async () => {
  for (const make of [() => new Response('TEST_SECRET PRIVATE', { status: 429 }), () => response('not-json'), () => response(undefined, 'wrong/model'), () => response(undefined, undefined, 'length'), () => Response.json({ error: { message: 'private' } })]) {
    const audits: Record<string, unknown>[] = [];
    const controller = new OpenRouterController(config().llm, 'TEST_SECRET', (_, r) => audits.push(r), async () => make());
    await assert.rejects(controller.decide(input, new AbortController().signal), { message: 'OpenRouter decision failed; inspect private audit' });
    assert.equal(audits[0]?.success, false); assert.ok(!JSON.stringify(audits).includes('TEST_SECRET'));
  }
});
test('aborted network request is audited without leaking original error', async () => {
  const audits: Record<string, unknown>[] = [];
  const controller = new OpenRouterController(config().llm, 'TEST_SECRET', (_, r) => audits.push(r), async (_, options) => { options?.signal?.throwIfAborted(); throw new Error('PRIVATE'); });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(controller.decide(input, abort.signal), /inspect private audit/);
  assert.equal(audits.length, 1);
});
test('truncated output is a nonretryable token-budget error', async () => {
  const audits: Record<string, unknown>[] = [];
  const controller = new OpenRouterController(config().llm, 'TEST_SECRET', (_, r) => audits.push(r), async () => response('', 'test/model', 'length'));
  await assert.rejects(controller.decide(input, new AbortController().signal), e => e instanceof ProviderDecisionError && e.code === 'output_token_limit' && e.retryable === false);
  assert.equal(audits[0]?.code, 'output_token_limit');
});

test('rate limiting stops immediate retries without exposing provider error bodies', async () => {
  const audits: Record<string, unknown>[] = [];
  const controller = new OpenRouterController(config().llm, 'TEST_SECRET', (_, r) => audits.push(r), async () => new Response('PRIVATE_PROVIDER_DETAIL', { status: 429 }));
  await assert.rejects(controller.decide(input, new AbortController().signal), e => e instanceof ProviderDecisionError && e.code === 'http_429' && e.retryable === false && !e.message.includes('PRIVATE_PROVIDER_DETAIL'));
  assert.equal(audits[0]?.status, 429);
});
test('mock HTTP five-controller ten-round integration persists raw responses and finishes', async () => {
  const store = new SqliteEventStore(':memory:'); const c = config(); store.createSession('s', c);
  const mock: typeof fetch = async (_, options) => {
    const body = JSON.parse(String(options?.body)); const i = JSON.parse(body.messages[1].content) as DecisionInput;
    const a = answer();
    const actions = i.phase === 'commit' ? [{ type: 'vote', actionId: 'vote', color: i.agentId === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [];
    return response(JSON.stringify({ ...a, actions }));
  };
  try {
    const controllers = Object.fromEntries(c.players.map(id => [id, new OpenRouterController(c.llm, 'TEST_SECRET', (snapshot, record) => store.recordAudit('s', snapshot, record), mock)]));
    const coordinator = new DecisionCoordinator(store, 's', controllers);
    let completed = false;
    for (let n = 0; n < 100; n++) if (await coordinator.step(async () => {}) === 'completed') { completed = true; break; }
    assert.ok(completed); assert.equal(store.readAudit('s').length, 150);
    assert.ok(store.readAudit('s').every(r => r.success === true && typeof r.rawResponse === 'string'));
    assert.ok(!JSON.stringify(store.readAudit('s')).includes('TEST_SECRET'));
    assert.equal((await store.readEvents('s', 0)).at(-1)?.data.type, 'game_ended');
  } finally { store.close(); }
});
