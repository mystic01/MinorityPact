import { chromium } from 'playwright-core';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { SqliteEventStore } from '../src/infrastructure/sqlite-store.ts';
import { parseConfig } from '../src/domain/config.ts';
import { createApp } from '../src/server/app.ts';
import { RESPONSE_START, RESPONSE_END } from '../src/controllers/manual-file.ts';

const store = new SqliteEventStore(':memory:');
const root = resolve('data/manual-browser-qa');
const config = parseConfig(JSON.parse(readFileSync('configs/experimental.json', 'utf8')));
let app = createApp({ store, config, manualRoot: root }); // No API key or provider controller.
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
  await page.getByLabel('AI 連接方式').selectOption('manual_file');
  await page.getByRole('button', { name: '建立新對局 ＋' }).click();
  await page.getByRole('button', { name: '開始對局', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.manual-players [role=status]')].filter(e => e.textContent === '等待回覆').length === 5);
  const id = store.listSessions()[0]!;
  const fill = async (seat: string, malformed = false) => {
    const p = (await store.loadCheckpoint(id))!.pendingDecisions.find(p => p.snapshot.input.agentId === seat)!;
    const i = p.snapshot.input;
    const path = join(root, id, `player-${seat}.md`);
    const content = readFileSync(path, 'utf8');
    const answer = malformed ? '{unfinished' : JSON.stringify({ requestId: i.snapshotId, decision: { actions: [{ type: 'set_ready', actionId: 'r', ready: true, scheduledTimeMs: i.logicalTimeMs }], nextWake: { atGameTimeMs: null, onEvents: [] }, strategyNote: { goal: '獨勝', plan: '離線測試', whyThisAction: '測試', predictedOutcome: '未知', observedEventIds: [], revisionReason: null } } });
    writeFileSync(path, content.slice(0, content.indexOf(RESPONSE_START)) + RESPONSE_START + '\n' + answer + '\n' + RESPONSE_END);
  };
  await fill('A', true);
  await page.getByText('驗證失敗：JSON 格式或 requestId 錯誤，請重新貼回完整答案', { exact: true }).waitFor();
  await fill('A');
  await page.getByText('已接受', { exact: true }).waitFor();
  assert.equal((await store.readEvents(id, 0)).length, 0);
  assert.equal(await page.getByText('等待回覆', { exact: true }).count(), 4);
  mkdirSync('.npm-cache/browser-qa', { recursive: true });
  await page.screenshot({ path: '.npm-cache/browser-qa/manual-progress.png', fullPage: true });
  for (const seat of ['B', 'C', 'D', 'E']) await fill(seat);
  await page.waitForFunction(() => [...document.querySelectorAll('.manual-players small')].filter(e => e.textContent?.includes('秘密投票')).length === 5);
  assert.ok((await store.readEvents(id, 0)).length > 0);
  await page.getByRole('button', { name: '暫停', exact: true }).click();
  await page.getByText('已暫停', { exact: true }).waitFor();
  app.stop(); await new Promise(r => setTimeout(r, 1200));
  app = createApp({ store, config, manualRoot: root });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  await page.goto(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`);
  await page.getByRole('button', { name: '繼續對局', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.manual-players small')].filter(e => e.textContent?.includes('秘密投票')).length === 5);
  assert.deepEqual(errors, []);
  console.log('Manual browser QA passed: no key, five waiting seats, malformed recovery, partial acceptance, automatic commit transition, pause and server restart/resume.');
} finally { await browser.close(); app.stop(); await new Promise(r => setTimeout(r, 1200)); store.close(); }
