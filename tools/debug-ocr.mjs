/** 调试：上传手表截图，打印真实 OCR 文本与解析结果（开发用） */
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const shot = resolve(process.cwd(), 'tests/fixtures/watch-summary.png');
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/ocr|tesseract|error|fail/i.test(t)) console.log('[console]', m.type(), t.slice(0, 200));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

await page.goto(`${base}/#/summary`, { waitUntil: 'networkidle' });
await page.getByTestId('summary-start').click();
await page.getByTestId('wizard-next').click();
await expectStep(page, 2);

console.log('上传截图…');
await page.getByTestId('ocr-input-watch').setInputFiles(shot);
// 等附件写入 + 识别完成
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(3000);
  const status = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('wo-de-xun-lian');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const rows = await new Promise((res, rej) => {
      const tx = db.transaction('attachments', 'readonly');
      const req = tx.objectStore('attachments').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const row = rows[rows.length - 1];
    return row ? { status: row.ocrStatus, text: row.ocrText ?? '' } : null;
  });
  if (status?.status === 'done' || status?.status === 'failed') {
    console.log('--- OCR 状态:', status.status);
    console.log('--- OCR 文本 ---');
    console.log(status.text);
    console.log('--- 解析后的字段 ---');
    const fields = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('wo-de-xun-lian');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const rows = await new Promise((res, rej) => {
        const tx = db.transaction('dailyLogs', 'readonly');
        const req = tx.objectStore('dailyLogs').getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      return rows[rows.length - 1]?.watch ?? {};
    });
    console.log(fields);
    break;
  }
  console.log('等待识别…', i * 3, 's');
}

await browser.close();

async function expectStep(page, n) {
  await page
    .getByTestId('wizard-progress')
    .filter({ hasText: `第 ${n} /` })
    .first()
    .waitFor({ timeout: 20000 });
}
