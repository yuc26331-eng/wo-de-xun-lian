import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const WATCH_SHOT = resolve(process.cwd(), 'tests/fixtures/watch-summary.png');

/** 当前浏览器里今天的每日记录条数（应始终为 1） */
async function todayLogCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wo-de-xun-lian');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const now = new Date();
    const iso = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction('dailyLogs', 'readonly');
      const req = tx.objectStore('dailyLogs').index('date').count(iso);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

test.describe('今日总结：逐步引导', () => {
  test('开始 → 逐步填写 → 自动保存草稿 → 最终归档，且同一天只有一条记录', async ({
    page,
  }) => {
    await page.goto('/#/summary');
    await expect(page.getByTestId('summary-start')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('summary-start').click();

    // ① 训练
    await expect(page.getByTestId('wizard-progress')).toContainText('第 1 / 7 步');
    await page.getByTestId('wizard-training-items').fill('下肢力量');
    await page.getByTestId('wizard-training-count').fill('2');
    await page.getByTestId('wizard-training-durations').fill('60, 30');
    await expect(page.getByTestId('wizard-save-status')).toContainText(/保存|已保存/, {
      timeout: 15_000,
    });
    await page.getByTestId('wizard-next').click();

    // ② 手表（跳过）③ 睡眠（跳过）
    await expect(page.getByTestId('wizard-progress')).toContainText('第 2 / 7 步');
    await page.getByTestId('wizard-skip').click();
    await expect(page.getByTestId('wizard-progress')).toContainText('第 3 / 7 步');
    await page.getByTestId('wizard-skip').click();

    // ④ 强度与身体感受（点选为主）
    await expect(page.getByTestId('wizard-progress')).toContainText('第 4 / 7 步');
    await page.getByTestId('wizard-rpe-8').click();
    await page.getByTestId('wizard-fatigue-4').click();
    await page.getByTestId('wizard-weight').fill('71.4');
    await page.getByTestId('wizard-next').click();

    // ⑤ 补剂
    await expect(page.getByTestId('wizard-progress')).toContainText('第 5 / 7 步');
    await page.getByTestId('wizard-protein-scoops').fill('2');
    await page.getByTestId('wizard-creatine').fill('5');
    await page.getByRole('button', { name: /镁/ }).click();
    await page.getByTestId('wizard-next').click();

    // ⑥ 其他补充
    await expect(page.getByTestId('wizard-progress')).toContainText('第 6 / 7 步');
    await page.getByTestId('wizard-free-note').fill('今天状态不错');
    await page.getByTestId('wizard-next').click();

    // ⑦ 确认
    await expect(page.getByTestId('wizard-progress')).toContainText('第 7 / 7 步');
    const review = page.getByTestId('wizard-review');
    await expect(review).toContainText('下肢力量');
    await expect(review).toContainText('60 分钟');
    await expect(review).toContainText('8'); // RPE
    await expect(review).toContainText('蛋白粉');
    await expect(review).toContainText('镁');
    await expect(review).toContainText('今天状态不错');

    await page.getByTestId('wizard-save').click();
    await expect(page.getByText('今日总结已保存归档')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('summary-final-card')).toBeVisible();
    expect(await todayLogCount(page)).toBe(1);

    // 再次进入可以编辑，修改后仍然只有一条
    await page.getByTestId('summary-edit').click();
    await page.getByTestId('wizard-prev').click();
    await expect(page.getByTestId('wizard-free-note')).toHaveValue('今天状态不错');
    await page.getByTestId('wizard-free-note').fill('改成了新的感受');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-save').click();
    await expect(page.getByTestId('summary-final-card')).toBeVisible({ timeout: 20_000 });
    expect(await todayLogCount(page)).toBe(1);
  });

  test('草稿恢复：填到第 4 步刷新后继续上次进度', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-training-items').fill('草稿恢复测试');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-skip').click();
    await page.getByTestId('wizard-skip').click();
    await expect(page.getByTestId('wizard-progress')).toContainText('第 4 / 7 步');
    await page.getByTestId('wizard-rpe-7').click();
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByTestId('wizard-progress')).toContainText('第 4 / 7 步', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('wizard-rpe-7')).toHaveClass(/active/);
    await page.getByTestId('wizard-prev').click();
    await page.getByTestId('wizard-prev').click();
    await page.getByTestId('wizard-prev').click();
    await expect(page.getByTestId('wizard-training-items')).toHaveValue('草稿恢复测试');
  });

  test('休息日：选择「今天未训练」也能继续完成总结', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-rest-day').click();
    await expect(page.getByText(/已标记为休息日/)).toBeVisible();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-progress')).toContainText('第 2 / 7 步');
  });
});

test.describe('Apple Watch 截图：真实识别与纠错', () => {
  test('上传截图 → 本地 OCR 识别出运动数据 → 写入草稿并可修改', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-next').click(); // 进入第 2 步（手表）
    await expect(page.getByTestId('wizard-progress')).toContainText('第 2 / 7 步');

    await page.getByTestId('ocr-input-watch').setInputFiles(WATCH_SHOT);

    // 真实 OCR：等待识别结果写入字段（首次需要加载语言模型）
    await expect(page.getByTestId('ocr-field-watch-activeEnergyKcal')).toHaveValue('620', {
      timeout: 180_000,
    });
    await expect(page.getByTestId('ocr-field-watch-exerciseMinutes')).toHaveValue('76');
    await expect(page.getByTestId('ocr-field-watch-standHours')).toHaveValue('11');
    await expect(page.getByTestId('ocr-field-watch-steps')).toHaveValue('9123');
    await expect(page.getByTestId('ocr-field-watch-avgHr')).toHaveValue('128');
    await expect(page.getByTestId('ocr-field-watch-restingHr')).toHaveValue('52');
    await expect(page.getByTestId('ocr-field-watch-hrvMs')).toHaveValue('64');
    await expect(page.getByTestId('ocr-field-watch-bloodOxygenPct')).toHaveValue('97');
    await expect(page.getByText(/识别到 \d+ 项数据/)).toBeVisible();

    // 识别结果可以人工纠正
    await page.getByTestId('ocr-field-watch-steps').fill('9500');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-skip').click();
    await page.getByTestId('wizard-skip').click();
    await page.getByTestId('wizard-skip').click();
    await page.getByTestId('wizard-next').click();
    await expect(page.getByTestId('wizard-review')).toContainText('620 kcal');
    await expect(page.getByTestId('wizard-review')).toContainText('9500');

    await page.screenshot({ path: 'test-results/screens/ocr-watch-result.png', fullPage: true });
  });
});

test.describe('数据清理与目标', () => {
  test('首次打开自动备份并清理，目标保留并更新为 70kg / 12%', async ({ page }) => {
    // 先制造一条训练记录与今日总结
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-training-items').fill('清理前训练');
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    await page.goto('/#/');
    // 自动执行：先备份再清理，完成后弹出结果
    await expect(page.getByTestId('cleanup-result')).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText(/体重 70 kg、体脂率低于 12%/)).toBeVisible();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('cleanup-download').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/我的训练-清理前备份-\d{4}-\d{2}-\d{2}\.json/);
    await page.getByTestId('cleanup-dismiss').click();

    // 记录已清空：今日总结回到「开始」入口
    await page.goto('/#/summary');
    await expect(page.getByTestId('summary-start')).toBeVisible({ timeout: 20_000 });
    expect(await todayLogCount(page)).toBe(0);

    // 目标保留并更新
    await page.goto('/#/me');
    await expect(page.getByText('目标体重 70 kg')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('目标体脂率低于 12%')).toBeVisible();

    // 不会重复清理
    await page.goto('/#/');
    await expect(page.getByTestId('cleanup-result')).toBeHidden();
  });
});
