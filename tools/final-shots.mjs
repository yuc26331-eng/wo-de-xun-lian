/**
 * 线上站点首屏截图（仅可视区域，用于汇报展示）
 * 用法：node tools/final-shots.mjs [url] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const url = (process.argv[2] ?? 'https://yuc26331.github.io/wo-de-xun-lian/').replace(/\/$/, '');
const out = process.argv[3] ?? '../work/final';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();

await page.goto(`${url}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=今日计划');
await page.screenshot({ path: `${out}/home.png` });

await page.getByTestId('start-training').click();
await page.waitForSelector('[data-testid="live-progress"]');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/live.png` });

await page.goto(`${url}/#/data`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/data.png` });

await browser.close();
console.log('screenshots ->', out);
