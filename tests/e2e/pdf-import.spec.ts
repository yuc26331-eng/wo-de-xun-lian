import { expect, test } from '@playwright/test';
import { SAMPLE_PLAN_TEXT, makeScannedPdf, makeTextPdf } from './helpers';

test.describe('PDF 智能导入', () => {
  test('导入文字型健身计划 PDF：识别 → 确认 → 保存 → 可开始训练', async ({ page }) => {
    await page.goto('/');
    const pdf = await makeTextPdf(SAMPLE_PLAN_TEXT);
    await page
      .locator('[data-testid="import-pdf"] input[type="file"]')
      .setInputFiles({ name: 'chatgpt-plan.pdf', mimeType: 'application/pdf', buffer: pdf });

    await expect(page.getByRole('heading', { name: /导入确认/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/健身计划|下肢力量/).first()).toBeVisible();

    // 识别结果里应包含动作与组数信息（动作名称是可编辑输入框）
    await expect(page.getByTestId('exercise-card')).toHaveCount(4);
    await expect(page.getByTestId('ex-name-0')).toHaveValue(/杠铃深蹲/);
    await expect(page.getByTestId('ex-reps-0')).toHaveValue(/5/);
    await expect(page.getByTestId('ex-sets-0')).toHaveValue('4');

    // 用户可修改：把计划名称改成自定义内容
    const titleInput = page.getByTestId('import-title');
    await titleInput.fill('导入测试：下肢力量');

    await page.getByRole('button', { name: /确认保存|保存计划/ }).first().click();
    await expect(page.getByText(/已保存|导入成功/).first()).toBeVisible({ timeout: 15_000 });

    // 保存后能在训练页看到，并且可以直接开始
    await page.goto('/#/train');
    await expect(page.getByText('导入测试：下肢力量').first()).toBeVisible({ timeout: 15_000 });
  });

  test('扫描版 PDF 明确提示需要 OCR，不会假装识别成功', async ({ page }) => {
    await page.goto('/');
    const pdf = await makeScannedPdf();
    await page
      .locator('[data-testid="import-pdf"] input[type="file"]')
      .setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf });

    await expect(page.getByText(/OCR/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/扫描版|无法提取文字|图片型/).first()).toBeVisible();
  });
});
