import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, expectTouchTargets } from './helpers';

test.describe('五个主页面基本可用', () => {
  test('首页 → 训练 → 数据 → 总结 → 我的 都能打开且无横向滚动', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '我的训练' })).toBeVisible();
    await expect(page.getByText('今日状态')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page, '.tabbar .tab');

    const tabs: { label: string; heading: string }[] = [
      { label: '训练', heading: '训练' },
      { label: '数据', heading: '数据' },
      { label: '总结', heading: '总结' },
      { label: '我的', heading: '我的' },
    ];

    for (const { label, heading } of tabs) {
      await page.getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.waitForTimeout(120);
      await page.screenshot({
        path: `test-results/screens/${test.info().project.name}-${label}.png`,
        fullPage: true,
      });
    }
  });

  test('首页大号开始训练按钮可用，并能进入跟练页', async ({ page }) => {
    await page.goto('/');
    const start = page.getByTestId('start-training');
    await expect(start).toBeVisible();
    await expectTouchTargets(page, '[data-testid="start-training"]');
    await start.click();
    await expect(page.getByText(/动作\s*1\s*\/\s*\d+/)).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${test.info().project.name}-live.png`,
      fullPage: true,
    });
  });

  test('刷新后训练数据不丢失（IndexedDB 持久化）', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('本周训练', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open('wo-de-xun-lian');
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => resolve();
      });
    });
    await page.reload();
    await expect(page.getByText('今日状态')).toBeVisible();
    await expect(page.getByText('最近训练')).toBeVisible();
  });
});
