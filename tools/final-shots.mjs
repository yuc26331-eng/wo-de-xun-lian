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
await page.waitForSelector('[data-testid="today-plan-title"]');
await page.screenshot({ path: `${out}/home.png` });

await page.getByTestId('start-training').click();
await page.waitForSelector('[data-testid="live-progress"]');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/live.png` });

await page.goto(`${url}/#/data`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/data.png` });

// v1.1：今日总结（六大分区）
await page.goto(`${url}/#/summary`, { waitUntil: 'networkidle' });
const summaryStart = page.getByTestId('summary-start');
if (await summaryStart.isVisible().catch(() => false)) await summaryStart.click();
const summaryAdvanced = page.getByTestId('summary-advanced');
if (await summaryAdvanced.isVisible().catch(() => false)) await summaryAdvanced.click();
await page.getByTestId('summary-status').waitFor({ timeout: 20000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/summary.png` });

// v1.1：一键导出给 ChatGPT（含预览）
await page.getByTestId('open-export').click();
await page.getByText('查看 Markdown 预览').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/export.png` });
await page.keyboard.press('Escape');

// v1.1：ChatGPT 报告页 + 版本与更新
await page.goto(`${url}/#/summary?tab=chatgpt`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/chatgpt-reports.png` });
await page.goto(`${url}/#/me`, { waitUntil: 'networkidle' });
await page.getByTestId('update-check').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/update-panel.png` });

await browser.close();
console.log('screenshots ->', out);
