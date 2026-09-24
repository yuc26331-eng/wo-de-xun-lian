import { expect, test } from '@playwright/test';
import { makeTextPdf } from './helpers';

test('旧版 iPhone Safari / 主屏 PWA 缺 Promise.withResolvers 时仍可预览并保存完整计划', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'webkit', '该回归只在 iPhone WebKit 项目运行');

  await page.addInitScript(() => {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });

  const pdf = await makeTextPdf([
    'Safari 兼容测试计划',
    '日期：2026-09-25',
    '正式训练',
    '1. 深蹲 3组 x 10次 组间休息 60秒',
    '2. 哥本哈根侧桥 2组 x 25-35秒/侧 组间休息 45秒',
  ]);

  await page.goto('/#/summary?tab=chatgpt');
  await page
    .locator('[data-testid="import-plan-from-summary"] input[type="file"]')
    .setInputFiles({ name: 'safari-anonymous-plan.pdf', mimeType: 'application/pdf', buffer: pdf });

  await expect(page).toHaveURL(/#\/import\/confirm\?import=/, { timeout: 30_000 });
  await expect(page.getByTestId('import-title')).toHaveValue('Safari 兼容测试计划');
  await expect(page.getByTestId('plan-date')).toHaveValue('2026-09-25');
  await expect(page.getByTestId('exercise-card')).toHaveCount(2);
  await expect(page.getByTestId('ex-name-0')).toHaveValue('深蹲');
  await expect(page.getByTestId('ex-sets-0')).toHaveValue('3');
  await expect(page.getByTestId('ex-reps-0')).toHaveValue('10');
  await expect(page.getByTestId('ex-rest-0')).toHaveValue('60');
  await expect(page.getByTestId('ex-name-1')).toHaveValue('哥本哈根侧桥');
  await expect(page.getByTestId('ex-sets-1')).toHaveValue('2');
  await expect(page.getByTestId('ex-duration-1')).toHaveValue('25-35秒/侧');
  await expect(page.getByTestId('ex-rest-1')).toHaveValue('45');

  await page.getByRole('button', { name: '确认保存计划' }).click();
  await expect(page).toHaveURL(/#\/$/, { timeout: 30_000 });
  await page.goto('/#/train');
  await expect(page.getByText('Safari 兼容测试计划').first()).toBeVisible();
});
