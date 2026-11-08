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
import { ProviderDecisionError } from '../src/controllers/openrouter.ts';
const config = parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
const store = new SqliteEventStore(':memory:');
let releaseStage!: () => void; let firstBoundary = true;
let rateLimitNext = false;
const stageGate = new Promise<void>(resolve => { releaseStage = resolve; });
const app = createApp({ store, config, apiKey: 'SCRIPTED_TEST_ONLY', pace: async ms => { if (ms && firstBoundary) { firstBoundary = false; await stageGate; } }, controllers: c => Object.fromEntries(c.players.map(id => [id, { decide: async (i: DecisionInput): Promise<DecisionResult> => {
  if (rateLimitNext && id === 'D') throw new ProviderDecisionError('http_429', false);
  return {
  actions: i.phase === 'commit' ? [{ type: 'vote', actionId: 'v', color: id === 'A' ? 'red' : 'blue', scheduledTimeMs: i.logicalTimeMs }] : [
    ...(id === 'A' && i.round === 1 ? [{ type: 'send_private_message' as const, actionId: 'm', recipientId: 'B', message: 'BROWSER_SECRET', scheduledTimeMs: i.logicalTimeMs }] : []),
    ...(i.round === 1 ? [{ type: 'send_public_message' as const, actionId: 'public', message: `${id}：這一輪，我想聽聽大家的選擇。\n先聽各位的想法，再決定我的立場。\n我希望我們能保留討論的空間。\n最後的選擇，仍由每個人自己決定。`, scheduledTimeMs: i.logicalTimeMs }] : []),
    { type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: i.logicalTimeMs },
  ], nextWake: { onEvents: [] }, strategyNote: { goal: 'win', plan: 'SCRIPTED_PLAN', whyThisAction: 'test', predictedOutcome: 'unknown', observedEventIds: [] },
}; } }])) });
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
  if (problems.length) {
    mkdirSync('.npm-cache/browser-qa', { recursive: true });
    await page.screenshot({ path: '.npm-cache/browser-qa/layout-failure.png', fullPage: true });
    console.log(await page.evaluate(() => [...document.querySelectorAll('.stage,.players,.player-seat,.portrait-wrap,.table-center,.nameplate,.choice-token')].map(el => ({ name: el.className, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, bottom: el.getBoundingClientRect().bottom }))));
  }
  assert.deepEqual(problems, [], 'clock must not cover seat labels or reveal tokens');
}
async function assertViewportFit() {
  const layout = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight,
    outside: [...document.querySelectorAll('.dashboard,.stage-footer,.dialogue-strip,.journal-footnote,.replay')].filter(el => {
      const r = el.getBoundingClientRect(); return r.top < 0 || r.bottom > innerHeight + 1;
    }).map(el => el.className),
  }));
  assert.ok(layout.pageHeight <= layout.viewportHeight + 1, `page must fit viewport: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.outside, [], 'subtitles, controls and journal must be fully visible');
}
try {
  await page.goto(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
  await page.getByLabel('對局回合數').selectOption('5');
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.waitForFunction(() => document.querySelector('.header-round')?.textContent?.includes('/ 5'));
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.locator('.speech-bubble').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.portrait')].length === 5 && [...document.querySelectorAll<HTMLImageElement>('.portrait')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await page.locator('.player-seat.speaking').count(), 1);
  assert.ok((await page.locator('.batch-heading').allTextContents()).some(t => t.includes('同批獨立表態')));
  const speechBatch = page.locator('.event-batch').filter({ has: page.locator('.read-message') });
  assert.equal(await speechBatch.count(), 1);
  assert.equal(await speechBatch.locator('.read-message').count(), 5);
  await page.getByRole('button', { name: 'E', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.speech-bubble span')?.textContent?.includes('正在閱讀 E'));
  await page.waitForTimeout(6700);
  assert.ok((await page.locator('.speech-bubble span').innerText()).includes('正在閱讀 E'), 'reading focus must not automatically rotate');
  await page.locator('.read-message').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.speech-bubble').length === 1 && !document.querySelector('.speech-enter-active,.speech-leave-active'));
  assert.equal(await page.locator('.portrait[data-expression="speaking"]').count(), 1);
  assert.equal(await page.locator('.choice-token svg').count(), 5);
  assert.equal(await page.locator('.choice-token.red,.choice-token.blue').count(), 0);
  await assertStageLayout();
  for (const [width, height] of [[1366,768],[1440,900],[1280,720],[1280,600],[1024,768]] as const) {
    await page.setViewportSize({ width, height });
    await assertViewportFit();
    await assertStageLayout();
    const bubble = await page.locator('.speech-bubble p').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, line: parseFloat(getComputedStyle(el).lineHeight) }));
    assert.ok(bubble.height >= bubble.line * 3.9, 'speech bubble must display four lines');
    assert.ok(bubble.scroll <= bubble.height + 1, 'four-line speech should fit without scrolling');
  }
  await page.setViewportSize({ width: 1366, height: 768 });
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
  await page.setViewportSize({ width: 1366, height: 768 });
  await assertViewportFit();
  await page.getByLabel('解鎖私訊與策略').check();
  await page.getByLabel('重播事件位置').evaluate((node: HTMLInputElement) => { node.value = node.max; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByText('BROWSER_SECRET', { exact: true }).waitFor();
  await page.getByLabel('解鎖私訊與策略').uncheck();
  await page.waitForFunction(() => !document.body.innerText.includes('BROWSER_SECRET'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.npm-cache/browser-qa/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  rateLimitNext = true;
  await page.getByRole('button', { name: '新對局 ＋', exact: true }).click();
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.locator('[role="alert"]').filter({ hasText: 'HTTP 429' }).waitFor();
  await assertViewportFit();
  await assertStageLayout();
  await page.screenshot({ path: '.npm-cache/browser-qa/theater-paused.png', fullPage: true });
  await page.getByRole('button', { name: '中止', exact: true }).click();
  rateLimitNext = false;
  await page.getByRole('button', { name: '新對局 ＋', exact: true }).click();
  await page.getByLabel('真人席位').selectOption('B');
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.getByRole('dialog', { name: '你的行動' }).waitFor();
  assert.equal(await page.locator('.portrait').count(), 5);
  assert.ok(!(await page.locator('body').innerText()).includes('BROWSER_SECRET'), 'pending AI output stays hidden');
  await page.getByLabel('公開發言', { exact: true }).fill('真人的公開提議');
  await page.getByLabel('私訊對象').selectOption('D');
  await page.getByLabel('私訊內容').fill('HUMAN_PRIVATE');
  await page.getByRole('button', { name: '提交並推進', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('BROWSER_SECRET'));
  await page.reload();
  await page.getByRole('button', { name: '提交並推進', exact: true }).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('BROWSER_SECRET'), 'own inbox survives reload');
  await assertViewportFit();
  await page.screenshot({ path: '.npm-cache/browser-qa/human-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '.npm-cache/browser-qa/human-mobile.png', fullPage: true });
  await page.getByLabel('我已準備投票（可在後續窗口撤回）').check();
  await page.getByRole('button', { name: '提交並推進', exact: true }).click();
  // D reacts to our private message in this batch, so the quiet-batch rule
  // requires one further submission before negotiation can finish.
  await page.getByText('交涉窗口 3／10', { exact: true }).waitFor();
  await page.getByRole('button', { name: '提交並推進', exact: true }).click();
  await page.getByRole('button', { name: '確認秘密選色', exact: true }).waitFor();
  await page.getByLabel('紅色', { exact: true }).check();
  await page.getByRole('button', { name: '確認秘密選色', exact: true }).click();
  await page.getByRole('button', { name: '提交並推進', exact: true }).waitFor();
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await page.getByRole('button', { name: '中止', exact: true }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
  console.log('SCRIPTED browser QA passed: create/start, 5 portraits, speaking expression, sealed/revealed choices, live privacy, replay secret toggle, mobile width, no page errors.');
} finally { releaseStage(); await browser.close(); app.stop(); store.close(); }
