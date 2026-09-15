/** 调试：完成 → 休息撤销 → 再完成 → 跳过休息 → 动作卡撤销 的实际状态变化 */
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const state = async (label) => {
  const setsDone = await page.locator('.set-dot.done').count().catch(() => -1);
  const cta = await page
    .getByTestId('live-complete-set')
    .textContent()
    .catch(() => '(无完成本组按钮)');
  const rest = await page.getByTestId('live-rest-timer').isVisible().catch(() => false);
  console.log(`${label}: 已完成圆点=${setsDone} 按钮="${(cta ?? '').trim()}" 休息中=${rest}`);
};

await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
await page.getByTestId('start-training').click();
await page.getByTestId('live-complete-set').waitFor({ timeout: 20000 });
await state('初始');

await page.getByTestId('live-complete-set').click();
await page.waitForTimeout(500);
await state('完成第1组');

await page.getByTestId('live-rest-undo').click();
await page.waitForTimeout(500);
await state('休息界面撤销');

await page.getByTestId('live-complete-set').click();
await page.waitForTimeout(500);
await state('再完成第1组');

await page.getByTestId('live-rest-skip').click();
await page.waitForTimeout(500);
await state('跳过休息');

console.log('撤销按钮数量:', await page.getByTestId('live-undo-set').count());
await page.getByTestId('live-undo-set').click();
await page.waitForTimeout(700);
await state('动作卡撤销后');

await browser.close();
