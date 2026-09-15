/** 调试：执行一次性清理并打印目标写入结果（开发用） */
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
await page.getByTestId('cleanup-banner-run').click();
await page.getByTestId('cleanup-run').click();
await page.getByTestId('cleanup-run').click();
await page.waitForTimeout(3000);
console.log('提示文本:', await page.locator('.toast').allTextContents());

const goals = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('wo-de-xun-lian');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const rows = await new Promise((res, rej) => {
    const tx = db.transaction('goals', 'readonly');
    const req = tx.objectStore('goals').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const settings = await new Promise((res, rej) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('app');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const counts = {};
  for (const store of ['plans', 'summaries', 'dailyLogs', 'bodyMetrics', 'attachments', 'sessions']) {
    counts[store] = await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  return { goals: rows.map((g) => `${g.title}|${g.targetValue}${g.unit ?? ''}`), settings, counts };
});
console.log('goals in IndexedDB:', JSON.stringify(goals.goals, null, 1));
console.log('settings:', {
  bodyWeightGoalKg: goals.settings?.bodyWeightGoalKg,
  bodyFatGoalPct: goals.settings?.bodyFatGoalPct,
  cleanupVersion: goals.settings?.cleanupVersion,
});
console.log('counts:', goals.counts);

await page.goto(`${base}/#/me`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const text = await page.getByRole('main').innerText();
console.log('我的页面前 400 字：', text.slice(0, 400).replace(/\n/g, ' | '));
console.log('包含目标体重 70:', text.includes('目标体重 70'));

await browser.close();
