import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_PLAN_TEXT, makeTextPdf } from './helpers';

async function waitForInitialCleanup(page: Page) {
  await page.goto('/#/');
  await expect(page.getByTestId('today-plan-title')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('wo-de-xun-lian', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const settings = await new Promise<{ cleanupVersion?: number } | undefined>(
          (resolve, reject) => {
            const request = db.transaction('settings').objectStore('settings').get('app');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        db.close();
        return settings?.cleanupVersion ?? 0;
      }),
    )
    .toBeGreaterThan(0);
}

test.describe('已修复回归', () => {
  test('总结页清楚区分训练计划与分析报告导入入口', async ({ page }) => {
    await waitForInitialCleanup(page);
    await page.goto('/#/summary?tab=chatgpt');
    await expect(page.getByText('导入训练计划', { exact: true })).toBeVisible();
    await expect(page.getByTestId('import-plan-from-summary-button')).toContainText('选择训练计划 PDF');
    await expect(page.getByText('导入分析报告', { exact: true })).toBeVisible();
    await expect(page.getByTestId('import-analysis-report-from-summary-button')).toContainText(
      '选择分析报告 PDF',
    );
    await expect(page.getByText(/不会创建训练计划/)).toBeVisible();
  });

  test('分析报告建议里出现“下周训练计划”时仍可按分析报告导入，且拒绝草稿会清理', async ({ page }) => {
    await waitForInitialCleanup(page);
    const pdf = await makeTextPdf([
      '训练分析报告',
      '日期范围：2026-09-10 至 2026-09-16',
      '本周训练完成情况正常。',
      '建议',
      '下周训练计划：继续保持每周三次力量训练。',
    ]);

    await page.goto('/#/summary?tab=chatgpt');
    await page
      .locator('[data-testid="import-plan-from-summary"] input[type="file"]')
      .setInputFiles({ name: 'training-analysis.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByText(/更像分析报告/)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('wdxl:import-draft')))
      .toBeNull();

    await page
      .locator('[data-testid="import-analysis-report-from-summary"] input[type="file"]')
      .setInputFiles({ name: 'training-analysis.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/#\/import\/chatgpt/, { timeout: 20_000 });
    await expect(page.getByText(/导入确认/).first()).toBeVisible();
  });

  test('明确计划标题优先于页首“训练总结”，首页 / 训练 / 总结入口一致', async ({ page }) => {
    await waitForInitialCleanup(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['plans', 'sessions'], 'readwrite');
        tx.objectStore('plans').clear();
        tx.objectStore('sessions').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    const pdf = await makeTextPdf([
      '全身力量训练计划',
      '日期：2026-09-15',
      '训练总结',
      '本次状态正常。',
      '正式训练',
      '1. 深蹲 3组 x 10次',
      '2. 卧推 3组 x 8次',
      '3. 划船 3组 x 12次',
    ]);

    await page.goto('/#/');
    await page.reload();
    await expect(page.getByTestId('import-pdf-empty')).toBeVisible();
    await page
      .locator('[data-testid="import-pdf-empty"] input[type="file"]')
      .setInputFiles({ name: 'explicit-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/#\/import\/confirm\?import=/, { timeout: 20_000 });
    await expect(page.getByText('健身计划', { exact: true })).toBeVisible();
    await expect(page.getByTestId('exercise-card')).toHaveCount(3);

    await page.goto('/#/train');
    await page
      .locator('[data-testid="import-pdf-train"] input[type="file"]')
      .setInputFiles({ name: 'explicit-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/#\/import\/confirm\?import=/, { timeout: 20_000 });
    await expect(page.getByText('健身计划', { exact: true })).toBeVisible();
    await expect(page.getByTestId('exercise-card')).toHaveCount(3);

    await page.goto('/#/summary?tab=chatgpt');
    await page
      .locator('[data-testid="import-plan-from-summary"] input[type="file"]')
      .setInputFiles({ name: 'explicit-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/#\/import\/confirm\?import=/, { timeout: 20_000 });
    await expect(page.getByText('健身计划', { exact: true })).toBeVisible();
    await expect(page.getByTestId('exercise-card')).toHaveCount(3);
  });

  test('以前误存成总结的同一 PDF 可以重新按训练计划导入', async ({ page }) => {
    await waitForInitialCleanup(page);
    const pdf = await makeTextPdf(SAMPLE_PLAN_TEXT);
    const fileSize = pdf.byteLength;
    await page.evaluate(async (size) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('pdfImports', 'readwrite');
        tx.objectStore('pdfImports').put({
          id: 'old-misfiled-summary',
          fileName: 'misfiled-plan.pdf',
          fileSize: size,
          pageCount: 1,
          importedAt: new Date().toISOString(),
          kind: 'daily-summary',
          pages: [],
          text: '',
          ocrRequired: false,
          saved: true,
          dailyLogId: '2026-09-16',
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, fileSize);

    await page.goto('/#/summary?tab=chatgpt');
    await page
      .locator('[data-testid="import-plan-from-summary"] input[type="file"]')
      .setInputFiles({ name: 'misfiled-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/#\/import\/confirm\?import=/, { timeout: 20_000 });
    await expect(page.getByTestId('exercise-card')).toHaveCount(4);
  });

  test('“查看上次的导入结果”默认只读，复制计划需要明确点击且不覆盖旧记录', async ({ page }) => {
    await waitForInitialCleanup(page);
    const pdf = await makeTextPdf(SAMPLE_PLAN_TEXT);
    const fileSize = pdf.byteLength;
    await page.evaluate(
      async ({ size, text }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('wo-de-xun-lian', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const now = new Date().toISOString();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['plans', 'pdfImports'], 'readwrite');
          tx.objectStore('plans').put({
            id: 'reopen-old-plan',
            title: '上次已保存的计划',
            date: '2026-09-16',
            kind: 'strength',
            source: 'pdf',
            warmup: [],
            exercises: [],
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore('pdfImports').put({
            id: 'reopen-saved-import',
            fileName: 'reopen-plan.pdf',
            fileSize: size,
            pageCount: 1,
            importedAt: now,
            kind: 'plan',
            pages: [text],
            text,
            ocrRequired: false,
            saved: true,
            planId: 'reopen-old-plan',
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { size: fileSize, text: SAMPLE_PLAN_TEXT.join('\n') },
    );

    await page.goto('/#/train');
    await page.reload();
    await page
      .locator('[data-testid="import-pdf-train"] input[type="file"]')
      .setInputFiles({ name: 'reopen-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByText('这个文件之前导入过')).toBeVisible();
    await page.getByRole('button', { name: '查看上次的导入结果' }).click();

    await expect(page).toHaveURL(/#\/import\/confirm\?import=reopen-saved-import/, {
      timeout: 20_000,
    });
    await expect(page.getByText(/这是上次已保存的导入结果/)).toBeVisible();
    await expect(page.getByRole('button', { name: /确认保存计划/ })).toHaveCount(0);
    await page.getByRole('button', { name: /复制为新计划/ }).click();

    await expect(page).toHaveURL(/#\/$/, { timeout: 20_000 });
    const state = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const plans = await new Promise<Array<{ id: string }>>((resolve, reject) => {
        const request = db.transaction('plans').objectStore('plans').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise<{ planId?: string } | undefined>((resolve, reject) => {
        const request = db
          .transaction('pdfImports')
          .objectStore('pdfImports')
          .get('reopen-saved-import');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { planIds: plans.map((plan) => plan.id), recordPlanId: record?.planId };
    });
    expect(state.planIds).toHaveLength(2);
    expect(state.planIds).toContain('reopen-old-plan');
    expect(state.recordPlanId).toBe('reopen-old-plan');
  });

  test('已保存周计划复查默认只读，显式复制后不覆盖旧导入记录', async ({ page }) => {
    await waitForInitialCleanup(page);
    const lines = [
      '周训练计划',
      '周一 2026-09-14 力量',
      '1. 深蹲 3组 x 5次',
      '周二 2026-09-15 休息',
      '周三 2026-09-16 上肢',
      '1. 卧推 3组 x 8次',
    ];
    const pdf = await makeTextPdf(lines);
    const fileSize = pdf.byteLength;
    await page.evaluate(
      async ({ size, text }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('wo-de-xun-lian', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const now = new Date().toISOString();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['plans', 'pdfImports'], 'readwrite');
          tx.objectStore('plans').put({
            id: 'old-week-plan',
            title: '旧周计划第一天',
            date: '2026-09-14',
            kind: 'strength',
            source: 'pdf',
            warmup: [],
            exercises: [],
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore('pdfImports').put({
            id: 'reopen-week-import',
            fileName: 'reopen-week-plan.pdf',
            fileSize: size,
            pageCount: 1,
            importedAt: now,
            kind: 'weekly-plan',
            pages: [text],
            text,
            ocrRequired: false,
            saved: true,
            planId: 'old-week-plan',
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { size: fileSize, text: lines.join('\n') },
    );

    await page.goto('/#/train');
    await page.reload();
    await page
      .locator('[data-testid="import-pdf-train"] input[type="file"]')
      .setInputFiles({ name: 'reopen-week-plan.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByText('这个文件之前导入过')).toBeVisible();
    await page.getByRole('button', { name: '查看上次的导入结果' }).click();
    await expect(page).toHaveURL(/#\/import\/confirm\?import=reopen-week-import/, {
      timeout: 20_000,
    });
    await expect(page.getByText(/这是上次已保存的导入结果/)).toBeVisible();
    await expect(page.getByRole('button', { name: /保存所选/ })).toHaveCount(0);
    await page.getByRole('button', { name: /复制为新周计划/ }).click();

    await expect(page).toHaveURL(/#\/train$/, { timeout: 20_000 });
    const state = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const plans = await new Promise<Array<{ id: string }>>((resolve, reject) => {
        const request = db.transaction('plans').objectStore('plans').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise<{ planId?: string } | undefined>((resolve, reject) => {
        const request = db
          .transaction('pdfImports')
          .objectStore('pdfImports')
          .get('reopen-week-import');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return { planIds: plans.map((plan) => plan.id), recordPlanId: record?.planId };
    });
    expect(state.planIds.length).toBeGreaterThan(1);
    expect(state.planIds).toContain('old-week-plan');
    expect(state.recordPlanId).toBe('old-week-plan');
  });

  test('首页没有今日计划时优先最近未来计划，再回退最近过去计划', async ({ page }) => {
    await waitForInitialCleanup(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const iso = (offset: number) => {
        const date = new Date();
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() + offset);
        return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      };
      const now = new Date().toISOString();
      const rows = [
        ['past-far', '较早过去计划', -6],
        ['past-near', '最近过去计划', -1],
        ['future-near', '最近未来计划', 1],
        ['future-far', '较远未来计划', 7],
      ];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('plans', 'readwrite');
        const store = tx.objectStore('plans');
        store.clear();
        for (const [id, title, offset] of rows) {
          store.put({
            id,
            title,
            date: iso(Number(offset)),
            kind: 'strength',
            source: 'manual',
            estimatedMinutes: 30,
            warmup: [],
            exercises: [],
            createdAt: now,
            updatedAt: now,
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await page.reload();
    await expect(page.getByTestId('today-plan-title')).toContainText('最近未来计划');

    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('plans', 'readwrite');
        tx.objectStore('plans').delete('future-near');
        tx.objectStore('plans').delete('future-far');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await page.reload();
    await expect(page.getByTestId('today-plan-title')).toContainText('最近过去计划');
  });

  test('日历展示同日全部训练，且已有蛋白质记录可以清空', async ({ page }) => {
    await waitForInitialCleanup(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const date = new Date();
      const today = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const now = new Date().toISOString();
      const summary = (id: string, title: string, hour: number) => ({
        id,
        sessionId: `session-${id}`,
        planId: `plan-${id}`,
        planTitle: title,
        kind: 'strength',
        date: today,
        startedAt: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).toISOString(),
        endedAt: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1).toISOString(),
        totalDurationSec: 3600,
        completedExercises: [],
        skippedExercises: [],
        totalSets: 3,
        totalReps: 15,
        totalVolumeKg: 500,
        completionRate: 1,
        cardio: [],
        rpe: 7,
        createdAt: now,
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['summaries', 'dailyLogs', 'bodyMetrics'], 'readwrite');
        const summaries = tx.objectStore('summaries');
        summaries.clear();
        summaries.put(summary('morning', '晨间力量', 8));
        summaries.put(summary('evening', '晚间力量', 18));
        tx.objectStore('dailyLogs').put({
          id: today,
          date: today,
          supplements: { proteinG: 30 },
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore('bodyMetrics').put({
          id: today,
          date: today,
          proteinG: 30,
          createdAt: now,
          updatedAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await page.goto('/#/data');
    await page.reload();
    await page.getByRole('tab', { name: '日历', exact: true }).click();
    await expect(page.getByText('2 次训练', { exact: true })).toBeVisible();
    await expect(page.getByText(/晨间力量/)).toBeVisible();
    await expect(page.getByText(/晚间力量/)).toBeVisible();

    await page.getByRole('button', { name: '记录这天的数据' }).click();
    const protein = page.getByLabel('蛋白质（g）');
    await expect(protein).toHaveValue('30');
    await protein.fill('');
    await page.getByTestId('save-metric').click();
    await expect(page.getByText('身体数据已保存').first()).toBeVisible();

    await page.getByRole('button', { name: '记录这天的数据' }).click();
    await expect(page.getByLabel('蛋白质（g）')).toHaveValue('');
    const saved = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const date = new Date();
      const today = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const row = await new Promise<{ supplements?: { proteinG?: number | null } } | undefined>(
        (resolve, reject) => {
          const request = db.transaction('dailyLogs').objectStore('dailyLogs').get(today);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return row?.supplements?.proteinG;
    });
    expect(saved).toBeNull();
  });

  test('只改训练备注不会改写原时长和容量，搜索框有可访问名称', async ({ page }) => {
    await waitForInitialCleanup(page);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const date = new Date();
      const today = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('summaries', 'readwrite');
        const store = tx.objectStore('summaries');
        store.clear();
        store.put({
          id: 'precision-summary',
          sessionId: 'precision-session',
          planId: 'precision-plan',
          planTitle: '精度测试训练',
          kind: 'strength',
          date: today,
          startedAt: now,
          endedAt: now,
          totalDurationSec: 90,
          completedExercises: [],
          skippedExercises: [],
          totalSets: 1,
          totalReps: 1,
          totalVolumeKg: 12.5,
          completionRate: 1,
          cardio: [],
          createdAt: now,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    await page.goto('/#/history');
    await page.reload();
    await expect(page.getByRole('textbox', { name: '搜索训练记录' })).toBeVisible();
    await page.getByRole('button', { name: /精度测试训练/ }).click();
    await page.getByTestId('record-edit-open').click();
    await expect(page.getByLabel('时长（分钟）')).toHaveValue('1.5');
    await expect(page.getByLabel('总容量（kg）')).toHaveValue('12.5');
    await page.getByLabel('备注').fill('仅修改备注');
    await page.getByTestId('record-edit-save').click();
    await expect(page.getByText('记录已更新').first()).toBeVisible();

    const saved = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('wo-de-xun-lian', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const row = await new Promise<{ totalDurationSec: number; totalVolumeKg: number }>(
        (resolve, reject) => {
          const request = db
            .transaction('summaries')
            .objectStore('summaries')
            .get('precision-summary');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return row;
    });
    expect(saved.totalDurationSec).toBe(90);
    expect(saved.totalVolumeKg).toBe(12.5);
  });
});
