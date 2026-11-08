// Read-only asset QA: checks generated PNGs without editing or resampling them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const rows: { id: string; expression: string; width: number; height: number; transparentPixels: number; visiblePixels: number; sha256: string }[] = [];
try {
  for (const id of ['A','B','C','D','E']) {
    const hashes = new Set<string>(); let dimension: string | undefined;
    for (const expression of ['neutral','speaking','smile','doubtful','surprised']) {
      const buffer = readFileSync(`web/public/avatars/${id}/${expression}.png`);
      assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      assert.ok(!hashes.has(sha256), `Duplicate expression file: ${id}/${expression}`); hashes.add(sha256);
      const stats = await page.evaluate(async source => {
        const image = new Image(); image.src = source; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparentPixels = 0, visiblePixels = 0;
        for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] === 0) transparentPixels++; else visiblePixels++; }
        return { width: image.width, height: image.height, transparentPixels, visiblePixels };
      }, `data:image/png;base64,${buffer.toString('base64')}`);
      assert.ok(stats.width >= 512 && stats.width === stats.height, `Expected square avatar: ${id}/${expression}`);
      assert.ok(stats.transparentPixels > stats.width * stats.height * .01, `Missing transparent background: ${id}/${expression}`);
      assert.ok(stats.visiblePixels > stats.width * stats.height * .1, `Empty image: ${id}/${expression}`);
      const size = `${stats.width}x${stats.height}`;
      if (dimension) assert.equal(size, dimension, `Expression dimensions differ for ${id}`); else dimension = size;
      rows.push({ id, expression, ...stats, sha256 });
    }
  }
  mkdirSync('.npm-cache/avatar-qa', { recursive: true });
  writeFileSync('.npm-cache/avatar-qa/results.json', JSON.stringify(rows, null, 2));
  console.log(`Validated ${rows.length} unique transparent PNGs with matching per-character dimensions.`);
} finally { await browser.close(); }
