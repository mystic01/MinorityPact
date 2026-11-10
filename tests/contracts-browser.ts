// Offline Chrome QA for human contract controls and private system notifications.
import { chromium } from 'playwright-core';
import { once } from 'node:events';
import { readFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { parseConfig } from '../src/domain/config.ts';
import { createApp } from '../src/server/app.ts';
import type { DecisionInput, DecisionResult, Action } from '../src/contracts/decision.ts';
import type { PaymentContract } from '../src/contracts/payment.ts';

const config = parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
const store = new SqliteEventStore(':memory:');
const app = createApp({ store, config, apiKey: 'SCRIPTED_TEST_ONLY', pace: async () => {}, controllers: c => Object.fromEntries(c.players.filter(id => id !== c.humanSeat).map(id => [id, {
  decide: async (input: DecisionInput): Promise<DecisionResult> => {
    const byId = new Map<string, PaymentContract>();
    for (const e of input.history) if (e.type === 'contract_updated') { const contract = e.publicPayload.contract as PaymentContract; byId.set(contract.id, contract); }
    const actions: Action[] = [];
    for (const contract of byId.values()) {
      if (contract.round !== input.round) continue;
      if (contract.status === 'proposed' && contract.recipient === id) actions.push({ type: 'accept_contract', actionId: 'accept', scheduledTimeMs: input.logicalTimeMs, contractId: contract.id });
      if (contract.status === 'active' && contract.cancelApprovals.length === 1 && !contract.cancelApprovals.includes(id)) actions.push({ type: 'cancel_contract', actionId: 'cancel', scheduledTimeMs: input.logicalTimeMs, contractId: contract.id });
    }
    return { actions: input.phase === 'commit' ? [{ type: 'vote', actionId: 'v', scheduledTimeMs: input.logicalTimeMs, color: 'blue' }] : actions,
      nextWake: { onEvents: [] }, strategyNote: { goal: '測試', plan: '腳本驗證', whyThisAction: '測試', predictedOutcome: '未知', observedEventIds: [] } };
  },
}])) });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await page.goto(base);
  await page.getByLabel('真人席位').selectOption('A');
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '你的行動' });
  await panel.getByLabel('契約收款人').selectOption('B');
  await panel.getByLabel('契約付款分數').fill('3');
  await panel.getByRole('button', { name: '加入契約提案' }).click();
  await panel.getByRole('button', { name: '提交並推進' }).click();
  await panel.getByText('等待下一個行動窗口。已提交的內容會保留。').waitFor({ state: 'hidden' });
  await panel.getByRole('button', { name: '提交並推進' }).waitFor();
  await panel.locator('article').filter({ hasText: '等待接受' }).waitFor();
  await panel.getByRole('button', { name: '提交並推進' }).click();
  await panel.getByRole('button', { name: '加入解除請求' }).waitFor();
  const id = store.listSessions()[0]!;
  const publicResponse = await fetch(`${base}/api/sessions/${id}`);
  const publicView = await publicResponse.json();
  assert.ok(!publicView.events.some((e: { type: string }) => e.type.startsWith('contract_')));
  await panel.getByRole('button', { name: '加入解除請求' }).click();
  await panel.getByRole('button', { name: '提交並推進' }).click();
  await panel.getByText('A 已同意解除，原契約仍有效。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '提交並推進' }).click();
  await panel.locator('article').filter({ hasText: '已解除' }).waitFor();
  mkdirSync('.npm-cache/browser-qa', { recursive: true });
  await page.screenshot({ path: '.npm-cache/browser-qa/contracts.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Contract Chrome QA passed: propose, accept, private notification, mutual cancellation and spectator privacy.');
} finally { await browser.close(); app.stop(); await new Promise(r => setTimeout(r, 150)); store.close(); }
