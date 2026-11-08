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
let releaseStage!: () => void; let firstBoundary = true;
const stageGate = new Promise<void>(resolve => { releaseStage = resolve; });
const app = createApp({ store, config, apiKey: 'SCRIPTED_TEST_ONLY', pace: async ms => { if (ms && firstBoundary) { firstBoundary = false; await stageGate; } }, controllers: c => Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput): Promise<DecisionResult> => ({
  actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: id === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [
    ...(id === 'A' && i.round === 1 ? [{ type: 'send_private_message' as const, actionId: 'm', recipientId: 'B', message: 'BROWSER_SECRET', scheduledTimeMs: i.logicalTimeMs }] : []),
    ...(i.round === 1 ? [{ type: 'send_public_message' as const, actionId: 'public', message: `${id}：這一輪，我想聽聽大家的選擇。`, scheduledTimeMs: i.logicalTimeMs }] : []),
    { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: i.logicalTimeMs },
  ], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'SCRIPTED_PLAN', whyThisAction: 'test', predictedOutcome: 'unknown', observedEventIds: [] },
}) }])) });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const failedAssets: string[] = [];
page.on('response', r => { if (r.status() >= 400 && /\.(png|js|css)(\?|$)/.test(r.url())) failedAssets.push(r.url()); });
async function assertStageLayout() {
  const problems = await page.evaluate(() => {
    const clock = document.querySelector('.table-center')!.getBoundingClientRect();
    return [...document.querySelectorAll('.choice-token,.nameplate')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.left < clock.right && rect.right > clock.left && rect.top < clock.bottom && rect.bottom > clock.top;
    }).map(el => el.className);
  });
  assert.deepEqual(problems, [], 'clock must not cover seat labels or reveal tokens');
}
try {
  await page.goto(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.locator('.speech-bubble').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.portrait')].length === 5 && [...document.querySelectorAll<HTMLImageElement>('.portrait')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await page.locator('.player-seat.speaking').count(), 1);
  assert.equal(await page.locator('.portrait[data-expression="speaking"]').count(), 1);
  assert.equal(await page.locator('.choice-token svg').count(), 5);
  assert.equal(await page.locator('.choice-token.red,.choice-token.blue').count(), 0);
  await assertStageLayout();
  assert.ok(!(await page.locator('body').innerText()).includes('BROWSER_SECRET'));
  mkdirSync('.npm-cache/browser-qa', { recursive: true });
  await page.screenshot({ path: '.npm-cache/browser-qa/theater-speaking.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertStageLayout();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.npm-cache/browser-qa/theater-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  releaseStage();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent?.includes('終局重播') && !b.disabled));
  assert.ok(!(await page.locator('body').innerText()).includes('BROWSER_SECRET'));
  assert.equal(await page.locator('.choice-token.red').count(), 1);
  assert.equal(await page.locator('.choice-token.blue').count(), 4);
  assert.equal(await page.locator('.player-seat.speaking').count(), 0);
  mkdirSync('.npm-cache/browser-qa', { recursive: true });
  await page.screenshot({ path: '.npm-cache/browser-qa/desktop.png', fullPage: true });
  for (const width of [1920, 1100, 768, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    await assertStageLayout();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
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
  assert.deepEqual(failedAssets, []);
  console.log('SCRIPTED browser QA passed: create/start, 5 portraits, speaking expression, sealed/revealed choices, live privacy, replay secret toggle, mobile width, no page errors.');
} finally { releaseStage(); await browser.close(); app.stop(); store.close(); }
