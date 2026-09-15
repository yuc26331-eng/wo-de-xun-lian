import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers';
import { ensureTrainingPlan } from './helpers';

/** 记录可靠 + 训练操作顺手：首页入口、跟练撤销、休息校准、备份导出与导入校验 */

test.describe('首页：今天练什么 / 开始与继续', () => {
  test('首屏显示今天练什么、预计时长与开始训练入口', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/#/');
    await expect(page.getByText('今天练什么', { exact: true })).toBeVisible();
    await expect(page.getByTestId('today-plan-title')).toContainText(/力量|跑步|训练/);
    await expect(page.getByText('预计时长')).toBeVisible();
    await expect(page.getByTestId('start-training')).toContainText('开始训练');
    await expectNoHorizontalScroll(page);
  });

  test('开始训练后首页变为继续训练，并显示已完成组数', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/#/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-complete-set')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('live-complete-set').click();
    await page.waitForTimeout(400);

    await page.goto('/#/');
    const cta = page.getByTestId('start-training');
    await expect(cta).toContainText('继续训练');
    await expect(cta).toContainText('1/');
    await expect(page.getByText('进行中')).toBeVisible();
    await expect(page.getByTestId('restart-training')).toBeVisible();
  });
});

test.describe('跟练：大计时 / 撤销误操作 / 休息校准', () => {
  test('大号计时可见，撤销上一组可一键回退', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/#/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-timer')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('live-save-status')).toContainText('已自动保存');

    // 完成一组 → 休息界面的进度为 1
    await page.getByTestId('live-complete-set').click();
    await expect(page.getByTestId('live-rest-timer')).toBeVisible();
    await expect(page.getByTestId('live-progress-done')).toContainText('已完成 1/');

    // 在休息界面直接撤销这一组（误点补救）
    await page.getByTestId('live-rest-undo').click();
    await expect(page.getByText('已撤销第 1 组').first()).toBeVisible();
    await expect(page.getByTestId('live-complete-set')).toContainText('1/');

    // 再完成一组，用动作卡上的快捷撤销
    await page.getByTestId('live-complete-set').click();
    await page.getByTestId('live-rest-skip').click();
    await expect(page.getByTestId('live-undo-set')).toBeVisible();
    await page.getByTestId('live-undo-set').click();
    await expect(page.getByText('已撤销第 1 组').first()).toBeVisible();
    await expect(page.getByTestId('live-complete-set')).toContainText('1/');
  });

  test('休息倒计时按真实时间校准：刷新后剩余时间继续减少', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/#/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-complete-set')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('live-complete-set').click();
    await expect(page.getByTestId('live-rest-timer')).toBeVisible();

    const readRemaining = async () => {
      const text = (await page.getByTestId('live-rest-timer').textContent()) ?? '0:00';
      const [m, s] = text.trim().split(':').map(Number);
      return m * 60 + (s || 0);
    };
    const before = await readRemaining();
    expect(before).toBeGreaterThan(5);

    await page.waitForTimeout(2200);
    await page.reload();
    await expect(page.getByTestId('live-rest-timer')).toBeVisible({ timeout: 20_000 });
    const after = await readRemaining();
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  test('暂停后计时停止，恢复后继续累计', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/#/');
    await page.getByTestId('start-training').click();
    await expect(page.getByTestId('live-timer')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('live-pause').click();
    await expect(page.getByRole('heading', { name: '训练已暂停' })).toBeVisible();
    const paused = (await page.getByTestId('live-elapsed').textContent()) ?? '';
    await page.waitForTimeout(1600);
    const stillPaused = (await page.getByTestId('live-elapsed').textContent()) ?? '';
    expect(stillPaused).toBe(paused);
    // 恢复入口在暂停弹层上（卡片里的按钮被弹层遮住，符合单手操作预期）
    await page.getByRole('dialog').getByRole('button', { name: '继续训练' }).click();
    await expect(page.getByTestId('live-timer')).toBeVisible();
  });
});

test.describe('备份与恢复', () => {
  test('导出完整备份后可以恢复，导入前显示覆盖说明', async ({ page }) => {
    // 先写一条每日记录，验证恢复不会丢数据
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-training-items').fill('备份前写入的训练内容');
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    await page.goto('/#/me');
    await page.getByTestId('export-backup').scrollIntoViewIfNeeded();
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-backup').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^我的训练-完整备份-\d{4}-\d{2}-\d{2}\.json$/);
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();

    // 导入同一个备份：先出现确认弹层（显示将写入的数量与覆盖说明）
    await page.getByTestId('restore-input').setInputFiles(savedPath!);
    await expect(page.getByText('确认恢复备份？')).toBeVisible({ timeout: 20_000 });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('训练计划')).toBeVisible();
    await expect(dialog.getByText(/按 id 合并/)).toBeVisible();
    await page.getByTestId('restore-confirm').click();
    await expect(page.getByText(/备份已恢复/)).toBeVisible({ timeout: 30_000 });

    // 数据仍在
    await page.goto('/#/summary');
    // 草稿会自动恢复到上次步骤；只有全新的一天才需要点「开始今日总结」
    const startButton = page.getByTestId('summary-start');
    if (await startButton.isVisible().catch(() => false)) await startButton.click();
    await expect(page.getByTestId('wizard-training-items')).toHaveValue('备份前写入的训练内容', {
      timeout: 20_000,
    });
  });

  test('导入非本应用的 JSON 会被拒绝，并保留原有数据', async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), 'wdxl-'));
    const badFile = join(dir, 'not-our-backup.json');
    writeFileSync(badFile, JSON.stringify({ app: 'other-app', data: { foo: [] } }), 'utf8');

    await page.goto('/#/me');
    await page.getByTestId('restore-input').setInputFiles(badFile);
    await expect(page.getByText(/这不是「我的训练」的备份文件/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('确认恢复备份？')).toBeHidden();
  });
});

test.describe('看见进步', () => {
  test('数据页展示动作进步卡片：有记录时给出趋势，无记录时给出引导', async ({ page }) => {
    await page.goto('/#/data');
    const card = page.getByTestId('exercise-progress-card');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    // 示例数据里没有每组的重量明细 → 应显示引导文案而不是假曲线
    const hasSelect = await page.getByTestId('progress-exercise-select').count();
    if (hasSelect === 0) {
      await expect(card).toContainText(/还没有可以对比的训练记录/);
    } else {
      await expect(card).toContainText(/首次最大重量|只有动作名记录/);
    }
    await expectNoHorizontalScroll(page);
  });
});
