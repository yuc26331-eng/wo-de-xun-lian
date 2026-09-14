/**
 * iPhone 尺寸截图脚本（开发/验收用）
 * 用法： node scripts/shots.mjs http://127.0.0.1:5199
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5199';
const outDir = 'test-results/shots';
mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'home', hash: '#/' },
  { name: 'train', hash: '#/train' },
  { name: 'data', hash: '#/data' },
  { name: 'summary', hash: '#/summary' },
  { name: 'profile', hash: '#/me' },
  { name: 'history', hash: '#/history' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await ctx.newPage();

for (const t of targets) {
  await page.goto(`${base}/${t.hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => ({
    widest: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewport: window.innerWidth,
  }));
  console.log(`${t.name}: 页面宽度 ${overflow.widest} / 视口 ${overflow.viewport}`);

  // 逐屏截图（避免 fullPage 与 100dvh 叠加导致的排版偏移）
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = await page.evaluate(() => window.innerHeight);
  const steps = Math.min(4, Math.max(1, Math.ceil(height / viewport)));
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), i * viewport);
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `${outDir}/${t.name}${steps > 1 ? `-${i + 1}` : ''}.png`,
    });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

await browser.close();
console.log(`截图输出目录：${outDir}`);
