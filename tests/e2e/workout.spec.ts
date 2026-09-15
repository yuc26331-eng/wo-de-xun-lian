import { expect, test } from '@playwright/test';
import { ensureTrainingPlan } from './helpers';

test.describe('实时跟练完整流程', () => {
  test.beforeEach(async ({ page }) => {
    await ensureTrainingPlan(page);
  });

  test('完成一组 → 休息倒计时 → 刷新后进度仍在（只记录一次）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-progress')).toContainText('动作 1/');

    const complete = page.getByTestId('live-complete-set');
    await expect(complete).toBeVisible();
    await expect(complete).toContainText('1/');

    await complete.click();
    await page.waitForTimeout(400);

    // 自动进入休息倒计时（休息期间不显示组点，跳过休息后回到动作卡片）
    await expect(page.getByTestId('live-rest-timer')).toBeVisible();
    await page.getByTestId('live-rest-skip').click();
    await expect(page.locator('.set-dot.done')).toHaveCount(1);

    // 刷新后进度仍然存在（中途退出可恢复）
    await page.reload();
    await expect(page.getByTestId('live-progress')).toContainText('动作 1/');
    await page.waitForTimeout(600);
    // 休息倒计时在刷新后仍在进行，跳过休息才能看到组点
    if (await page.getByTestId('live-rest-skip').isVisible().catch(() => false)) {
      await page.getByTestId('live-rest-skip').click();
    }
    await expect(page.locator('.set-dot.done')).toHaveCount(1);
  });

  test('跳过动作 / 加减一组 / 记录疼痛都生效', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-progress')).toContainText('动作 1/');

    // 增加一组
    const before = await page.locator('.set-dot').count();
    await page.getByTestId('live-add-set').click();
    await expect(page.locator('.set-dot')).toHaveCount(before + 1);
    await page.getByTestId('live-remove-set').click();
    await expect(page.locator('.set-dot')).toHaveCount(before);

    // 记录不适
    await page.getByTestId('live-pain-open').click();
    await expect(page.getByText('记录疼痛或不适')).toBeVisible();
    await page.getByTestId('live-pain-site').first().click();
    await page.getByTestId('live-pain-save').click();
    await expect(page.getByText('已记录疼痛，注意安全，必要时停止训练')).toBeVisible();

    // 跳到下一项
    await page.getByTestId('live-next').click();
    await expect(page.getByTestId('live-progress')).toContainText('动作 2/');
  });

  test('结束训练生成总结并可导出中文 PDF', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-progress')).toContainText('动作 1/');

    await page.getByTestId('live-complete-set').click();
    await page.waitForTimeout(300);

    await page.getByTestId('live-pause').click();
    await page.getByTestId('live-end-early').click();
    await expect(page.getByText('结束训练并保存总结')).toBeVisible();
    await page.getByTestId('live-finish-confirm').click();

    // 结束后跳到总结页，并展示今日总结
    await expect(page).toHaveURL(/summary/, { timeout: 20_000 });
    await expect(page.getByText('今日总结').first()).toBeVisible({ timeout: 20_000 });

    // 新的导出入口：一键导出给 ChatGPT → PDF
    await page.getByTestId('open-export').click();
    await expect(page.getByRole('heading', { name: '一键导出给 ChatGPT' })).toBeVisible();
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('export-pdf').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^训练与恢复记录_/);
    const filePath = await file.path();
    expect(filePath).toBeTruthy();
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(filePath!));
    expect(size).toBeGreaterThan(5000);
    const bytes = await import('node:fs').then((fs) => fs.promises.readFile(filePath!));
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await page.screenshot({ path: 'test-results/screens/summary-after-workout.png' });
  });
});
