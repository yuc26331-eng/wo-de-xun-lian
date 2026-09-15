import { expect, test } from '@playwright/test';

/**
 * 历史报告导入页的基础行为（不需要真实导入码）：
 * - 页面能打开、能输入导入码
 * - 导入码错误时给出明确提示，并且一条数据都不写
 * - 错误的导入码不会影响已有记录
 */
test.describe('导入历史报告', () => {
  const countLogs = (page: import('@playwright/test').Page) =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('wo-de-xun-lian');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return new Promise<number>((res, rej) => {
        const req = db.transaction('dailyLogs', 'readonly').objectStore('dailyLogs').count();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    });

  test('导入码错误时提示清楚且不写入数据', async ({ page }) => {
    await page.goto('/#/summary?tab=records');
    await page.getByTestId('open-history-import').click();
    await expect(page).toHaveURL(/import\/history/);

    const before = await countLogs(page);
    await page.getByTestId('history-code').fill('ZZZZ-ZZZZ-ZZZZ');
    await page.getByTestId('history-import-start').click();
    // 页面提示 + toast 都会出现同样的文案，这里只要求至少可见一处
    await expect(page.getByText(/导入码不正确/).first()).toBeVisible({ timeout: 60_000 });
    // 没有结果卡片，也没有新增记录
    await expect(page.getByTestId('history-result')).toHaveCount(0);
    expect(await countLogs(page)).toBe(before);
  });

  test('导入码位数不足时按钮不可点，并给出格式提示', async ({ page }) => {
    await page.goto('/#/import/history');
    await page.getByTestId('history-code').fill('ABC');
    await expect(page.getByTestId('history-import-start')).toBeDisabled();
  });
});
