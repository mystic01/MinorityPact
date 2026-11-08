// Scripted browser QA. No requests to OpenRouter.
import { chromium } from 'playwright-core';
import { once } from 'node:events';
import { readFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { parseConfig } from '../src/domain/config.ts';
import { createApp } from '../src/server/app.ts';
import type { DecisionInput, DecisionResult } from '../src/contracts/decision.ts';
const config = parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
const store = new SqliteEventStore(':memory:');
const app = createApp({ store, config, apiKey: 'SCRIPTED_TEST_ONLY', pace: async () => {}, controllers: c => Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput): Promise<DecisionResult> => ({
  actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: id === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [
    ...(id === 'A' && i.round === 1 ? [{ type: 'send_private_message' as const, actionId: 'm', recipientId: 'B', message: 'BROWSER_SECRET', scheduledTimeMs: i.logicalTimeMs }] : []),
    { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: i.logicalTimeMs },
  ], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'SCRIPTED_PLAN', whyThisAction: 'test', predictedOutcome: 'unknown', observedEventIds: [] },
}) }])) });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('終局重播') && !b.disabled));
  assert.ok(!(await page.locator('body').innerText()).includes('BROWSER_SECRET'));
  mkdirSync('.npm-cache/browser-qa', { recursive: true });
  await page.screenshot({ path: '.npm-cache/browser-qa/desktop.png', fullPage: true });
  await page.getByRole('button', { name: '終局重播 ↗' }).click();
  await page.getByLabel('解鎖私訊與策略').check();
  await page.getByLabel('重播事件位置').evaluate((node: HTMLInputElement) => { node.value = node.max; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByText('BROWSER_SECRET', { exact: true }).waitFor();
  await page.getByLabel('解鎖私訊與策略').uncheck();
  await page.waitForFunction(() => !document.body.innerText.includes('BROWSER_SECRET'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.npm-cache/browser-qa/mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('SCRIPTED browser QA passed: create/start, live privacy, replay secret toggle, mobile width, no page errors.');
} finally { await browser.close(); app.stop(); store.close(); }
