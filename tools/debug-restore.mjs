/** 调试备份导入流程（开发用）：打印控制台错误与提示文本 */
import { readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${base}/#/me`, { waitUntil: 'networkidle' });
const dl = page.waitForEvent('download', { timeout: 60000 });
await page.getByTestId('export-backup').click();
const download = await dl;
const filePath = await download.path();
const text = await readFile(filePath, 'utf8');
console.log('backup file:', download.suggestedFilename(), text.length, 'bytes');
console.log('head:', text.slice(0, 120).replace(/\s+/g, ' '));

await page.getByTestId('restore-input').setInputFiles(filePath);
await page.waitForTimeout(2500);
console.log(
  'sheet visible:',
  await page.getByText('确认恢复备份？').isVisible().catch(() => false),
);
console.log('toasts:', await page.locator('.toast').allTextContents());

await browser.close();
