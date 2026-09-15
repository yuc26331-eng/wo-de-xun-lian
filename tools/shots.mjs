/**
 * 视觉走查：在 iPhone 尺寸下逐页截图（开发用，不参与打包）
 * 用法：node tools/shots.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = process.argv[3] ?? '../work/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();

async function shot(name, path, full = true) {
  await page.goto(`${base}/#${path}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('shot', name);
}

await shot('01-home', '/');
await shot('02-train', '/train');
await shot('03-data', '/data');
await shot('04-summary', '/summary');
await shot('05-me', '/me');
await shot('06-history', '/history');

// 跟练页：点开始训练
await page.goto(`${base}/#/`);
await page.getByTestId('start-training').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/07-live.png` });
console.log('shot 07-live');
await page.getByTestId('live-complete-set').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/08-live-rest.png` });
console.log('shot 08-live-rest');

// 深色模式（跟随系统）
const dark = await browser.newContext({
  ...devices['iPhone 15'],
  locale: 'zh-CN',
  colorScheme: 'dark',
});
const darkPage = await dark.newPage();
await darkPage.goto(`${base}/#/`);
await darkPage.waitForTimeout(900);
await darkPage.screenshot({ path: `${out}/09-home-dark.png`, fullPage: true });
console.log('shot 09-home-dark');
await darkPage.goto(`${base}/#/data`);
await darkPage.waitForTimeout(900);
await darkPage.screenshot({ path: `${out}/10-data-dark.png`, fullPage: true });
console.log('shot 10-data-dark');

await browser.close();
