import { expect, test } from '@playwright/test';

test.describe('实时跟练完整流程', () => {
  test('完成一组 → 休息倒计时 → 刷新后进度仍在 → 防重复点击', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByText(/动作\s*1\s*\/\s*\d+/)).toBeVisible({ timeout: 15_000 });

    const complete = page.getByRole('button', { name: /完成本组/ });
    await expect(complete).toBeVisible();

    // 连点两次，只允许记录一组
    await complete.click({ clickCount: 2, delay: 40 });
    await page.waitForTimeout(500);

    const doneLabel = page.getByText(/已完成?\s*\d+\s*\/\s*\d+\s*组/).first();
    await expect(doneLabel).toBeVisible();
    const text = (await doneLabel.textContent()) ?? '';
    const done = Number(text.match(/(\d+)\s*\/\s*(\d+)/)?.[1] ?? '0');
    expect(done, `连续点击后应只记录 1 组，实际 ${done}`).toBe(1);

    // 休息倒计时出现
    await expect(page.getByText(/休息|倒计时/).first()).toBeVisible();

    // 刷新后进度仍然存在（中途退出可恢复）
    await page.reload();
    await expect(page.getByText(/动作\s*\d+\s*\/\s*\d+/)).toBeVisible({ timeout: 15_000 });
    const afterReload = page.getByText(/已完成?\s*\d+\s*\/\s*\d+\s*组/).first();
    await expect(afterReload).toBeVisible();
    await expect(afterReload).toContainText('1');
  });

  test('跳过动作 / 加减一组 / 记录疼痛都生效', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByText(/动作\s*1\s*\/\s*\d+/)).toBeVisible({ timeout: 15_000 });

    // 增加一组
    await page.getByRole('button', { name: /增加一组|\+1\s*组/ }).click();
    await expect(page.getByText(/已完成?\s*0\s*\/\s*\d+\s*组/).first()).toBeVisible();

    // 记录不适
    await page.getByRole('button', { name: /不适|疼痛/ }).first().click();
    await expect(page.getByText(/疼痛|不适/).first()).toBeVisible();
    await page.keyboard.press('Escape');

    // 跳到下一项
    await page.getByRole('button', { name: /下一项|下一个/ }).first().click();
    await expect(page.getByText(/动作\s*2\s*\/\s*\d+/)).toBeVisible();
  });

  test('结束训练生成总结并可导出中文 PDF', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-training').click();
    await expect(page.getByText(/动作\s*1\s*\/\s*\d+/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /完成本组/ }).click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /结束训练|完成训练/ }).first().click();
    await page.getByRole('button', { name: /保存总结|保存到历史/ }).first().click();

    await expect(page.getByText(/训练完成|今日总结/).first()).toBeVisible({ timeout: 15_000 });

    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: /导出\s*PDF|导出总结|保存为\s*PDF/ }).first().click();
    const file = await download;
    const path = await file.path();
    expect(path).toBeTruthy();
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(path!));
    expect(size).toBeGreaterThan(5000);
  });
});
