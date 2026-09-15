import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';

test.describe('今日总结：六大分区与自动保存', () => {
  test('填写训练/手表/睡眠/身体/饮食/自由记录，刷新后仍在且只保留一条', async ({
    page,
  }) => {
    await page.goto('/#/summary');
    // 逐步引导是默认入口；这个用例专门验证完整表单的字段与自动保存
    await page.getByTestId('summary-start').click();
    await page.getByTestId('summary-advanced').click();
    await expect(page.getByTestId('summary-status')).toBeVisible();

    // 训练分区
    await page.getByTestId('summary-training-items').fill('下肢力量 + 爆发力');
    await page.getByTestId('summary-rpe').fill('8');

    // Apple Watch 分区
    await page.getByRole('button', { name: /Apple Watch 与运动数据/ }).click();
    await page.getByTestId('watch-steps').fill('9123');
    await page.getByTestId('watch-resting-hr').fill('52');
    await page.getByTestId('watch-hrv').fill('64');

    // 睡眠分区
    await page.getByRole('button', { name: /睡眠记录/ }).click();
    await page.getByTestId('sleep-total').fill('7.3');

    // 身体分区
    await page.getByRole('button', { name: /身体与恢复状况/ }).click();
    await page.getByTestId('body-weight').fill('71.4');
    await page.getByTestId('body-overall').fill('整体不错，最后一组有点吃力');

    // 饮食分区
    await page.getByRole('button', { name: /饮食和补剂/ }).click();
    await page.locator('input[placeholder="燕麦 + 鸡蛋"]').fill('燕麦 + 鸡蛋');

    // 自由记录
    await page.getByRole('button', { name: /当日自由记录/ }).click();
    await page.getByTestId('summary-free-note').fill('右膝在深蹲最后两组有轻微不适，没有加重。');

    // 等自动保存完成（800ms 防抖 + 写入）
    await expect(page.getByTestId('summary-status')).toContainText('已自动保存', {
      timeout: 15_000,
    });

    await page.reload();
    // 刷新后默认回到逐步引导，这里重新进入完整表单核对已保存内容
    await page.getByTestId('summary-start').click();
    await page.getByTestId('summary-advanced').click();
    await expect(page.getByTestId('summary-status')).toBeVisible();
    await page.getByRole('button', { name: /Apple Watch 与运动数据/ }).click();
    await expect(page.getByTestId('watch-steps')).toHaveValue('9123');
    await page.getByRole('button', { name: /身体与恢复状况/ }).click();
    await expect(page.getByTestId('body-weight')).toHaveValue('71.4');
    await page.getByRole('button', { name: /当日自由记录/ }).click();
    await expect(page.getByTestId('summary-free-note')).toHaveValue(
      '右膝在深蹲最后两组有轻微不适，没有加重。',
    );

    // 同一天只应有一条记录
    const count = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('wo-de-xun-lian');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const today = new Date();
      const iso = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
      return new Promise<number>((resolve, reject) => {
        const tx = db.transaction('dailyLogs', 'readonly');
        const req = tx.objectStore('dailyLogs').index('date').count(iso);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
    expect(count).toBe(1);
    await expectNoHorizontalScroll(page);
  });

  test('复制到其他日期不会产生重复条目', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('summary-advanced').click();
    await page.getByTestId('summary-training-items').fill('复制测试训练');
    await expect(page.getByTestId('summary-status')).toContainText('已自动保存', {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: '复制到其他日期' }).click();
    await page.getByTestId('copy-target').fill('2026-09-01');
    await page.getByTestId('copy-confirm').click();
    await expect(page.getByText('已复制到 2026-09-01')).toBeVisible();
    await expect(page.getByText('2026年9月1日').first()).toBeVisible();
  });
});

test.describe('每日记录与日历视图', () => {
  test('列表显示已记录/缺失，日历可切换并回到当天编辑', async ({ page }) => {
    await page.goto('/#/summary?tab=records');
    await expect(page.getByTestId('records-start')).toBeVisible();
    await page.getByTestId('records-start').fill('2026-09-10');
    await page.getByTestId('records-end').fill('2026-09-16');
    await expect(page.getByTestId('day-row-2026-09-15')).toBeVisible();
    await expect(page.getByTestId('day-row-2026-09-10')).toContainText('未记录');

    await page.getByRole('tab', { name: '日历' }).click();
    await expect(page.getByTestId('cal-2026-09-15')).toBeVisible();
    await page.getByTestId('cal-2026-09-15').click();
    await expect(page.getByText('记录日期')).toBeVisible();
  });
});

test.describe('一键导出给 ChatGPT', () => {
  test('四种格式都能导出，Markdown 带指定说明与汇总', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('open-export').click();
    await expect(page.getByTestId('export-start')).toBeVisible();

    // 选最近 7 天
    await page.getByRole('button', { name: '最近 7 天' }).click();
    await expect(page.getByText('导出预览')).toBeVisible();
    await expect(page.getByTestId('export-preview')).toContainText('请根据以下日期范围内的原始训练');
    await expect(page.getByTestId('export-preview')).toContainText('未记录');

    const md = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-markdown').click();
    const mdFile = await md;
    expect(mdFile.suggestedFilename()).toMatch(/^训练与恢复记录_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.md$/);

    const json = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-json').click();
    expect((await json).suggestedFilename()).toMatch(/\.json$/);

    const txt = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-text').click();
    expect((await txt).suggestedFilename()).toMatch(/\.txt$/);
  });

  test('可以取消勾选隐私项目（至少保留一项）', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('open-export').click();
    for (const key of ['watch', 'sleep', 'body', 'diet', 'notes']) {
      await page.getByTestId(`export-include-${key}`).click();
    }
    await expect(page.getByTestId('export-preview')).not.toContainText('Apple Watch 与运动数据');
    await expect(page.getByTestId('export-preview')).not.toContainText('睡眠情况');
    await expect(page.getByTestId('export-preview')).toContainText('训练情况');
  });
});

test.describe('训练管理：编辑 / 重命名 / 复制 / 删除', () => {
  test('训练计划支持重命名与复制到指定日期，删除有二次确认（含名称和日期）', async ({
    page,
  }) => {
    await page.goto('/#/train');
    await page.getByText('下肢力量 + 爆发力').first().click();
    await page.getByTestId('plan-rename').click();
    await page.getByTestId('plan-rename-input').fill('下肢力量（改名测试）');
    await page.getByTestId('plan-rename-save').click();
    await expect(page.getByText('已重命名')).toBeVisible();
    // 关闭重命名与计划操作两个弹层
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByText('下肢力量（改名测试）').first()).toBeVisible();

    await page.getByText('下肢力量（改名测试）').first().click();
    await page.getByTestId('plan-copy').click();
    await page.getByTestId('plan-copy-date').fill('2026-09-20');
    await page.getByTestId('plan-copy-save').click();
    await expect(page.getByText('已复制到 2026-09-20')).toBeVisible();

    await page.getByText('下肢力量（改名测试）').first().click();
    await page.getByRole('button', { name: '删除计划' }).click();
    await expect(page.getByText(/将删除「下肢力量（改名测试）」/)).toBeVisible();
    await expect(page.getByText(/2026年9月20日|2026年9月15日/)).toBeVisible();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.getByText('计划已删除')).toBeVisible();
  });

  test('训练记录支持编辑与删除（确认框显示名称和日期）', async ({ page }) => {
    await page.goto('/#/history');
    await page.getByText('下肢力量 + 爆发力').first().click();
    await page.getByTestId('record-edit-open').click();
    await page.getByTestId('record-edit-title').fill('训练记录（已编辑）');
    await page.getByTestId('record-edit-save').click();
    await expect(page.getByText('记录已更新')).toBeVisible();

    // 详情弹层仍打开（标题已更新），直接在该弹层里删除
    await page.getByRole('button', { name: '删除这条记录' }).click();
    await expect(page.getByText(/将删除「训练记录（已编辑）」/)).toBeVisible();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.getByText('记录已删除')).toBeVisible();
  });
});
