/**
 * 导入确认页交互测试：
 * 草稿 -> 编辑 -> 保存 -> 真的写进 IndexedDB（不覆盖旧数据，按日期合并）
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import ImportConfirmPage from './ImportConfirmPage';
import { AppDataProvider } from '../state/AppData';
import { ToastProvider } from '../components/ui';
import { DB_NAME, dbGetAll, dbPut, getDB } from '../db/db';
import { DRAFT_KEY, saveDraftToSession } from '../lib/pdf/draft';
import { parsePlanText, parseWeeklyPlanBody } from '../lib/pdf/parsePlan';
import { parseSummaryText } from '../lib/pdf/parseSummary';
import { PLAN_TEXT, SUMMARY_TEXT, WEEKLY_TEXT } from '../lib/pdf/fixtures';
import type { DailyLog } from '../types';

function renderPage(entry = '/import/confirm') {
  return render(
    <AppDataProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <ImportConfirmPage />
        </MemoryRouter>
      </ToastProvider>
    </AppDataProvider>,
  );
}

async function resetDb() {
  await getDB();
  const db = await getDB();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

beforeEach(async () => {
  sessionStorage.clear();
  await resetDb();
});

describe('ImportConfirmPage - 健身计划', () => {
  it('展示解析结果、允许修改标题并保存为新的计划', async () => {
    const draft = parsePlanText(PLAN_TEXT, { importId: 'imp-plan', fileName: '下肢力量.pdf' });
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    const titleInput = await screen.findByTestId('import-title');
    expect((titleInput as HTMLInputElement).value).toContain('下肢力量');
    // 4 个动作卡片
    expect(screen.getAllByTestId('exercise-card')).toHaveLength(4);
    // 组数/重量被正确回填
    expect((screen.getByTestId('ex-name-0') as HTMLInputElement).value).toBe('杠铃深蹲');

    await user.clear(titleInput);
    await user.type(titleInput, '我自己改的计划名');
    await user.click(screen.getByRole('button', { name: /确认保存计划/ }));

    await waitFor(async () => {
      const plans = await dbGetAll('plans');
      const saved = plans.find((p) => p.title === '我自己改的计划名');
      expect(saved).toBeTruthy();
      expect(saved?.exercises).toHaveLength(4);
      expect(saved?.exercises[0].target.weightKg).toBe(90);
    });
    // 草稿已清除，避免重复导入
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('时间型动作在确认页显示时长而不是次数，并保留范围', async () => {
    const draft = parsePlanText(
      `计时核心训练
日期：2026-09-15
正式训练
1. 哥本哈根侧桥
2-3组 × 25-35秒/侧`,
      { importId: 'imp-timed', fileName: '计时核心训练.pdf' },
    );
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    const duration = await screen.findByTestId('ex-duration-0');
    expect((duration as HTMLInputElement).value).toBe('25-35秒/侧');
    expect(screen.queryByTestId('ex-reps-0')).toBeNull();

    await user.clear(duration);
    await user.type(duration, '30');
    await user.click(screen.getByRole('button', { name: /确认保存计划/ }));

    await waitFor(async () => {
      const plans = await dbGetAll('plans');
      const saved = plans.find((p) => p.title === '计时核心训练');
      expect(saved?.exercises[0].target.durationText).toBe('30秒/侧');
      expect(saved?.exercises[0].target.durationSec).toBe(30);
      expect(saved?.exercises[0].target.durationPerSide).toBe(true);
      expect(saved?.exercises[0].target.reps).toBeNull();
    });
  });

  it.each([
    ['30', '30秒/侧'],
    ['30秒', '30秒/侧'],
    ['30秒/侧', '30秒/侧'],
  ])('另存一份计划输入 %s 时复用时长校验并保存为 %s', async (input, expected) => {
    const draft = parsePlanText(
      `计时核心训练
日期：2026-09-15
1. 哥本哈根侧桥
2-3组 × 25-35秒/侧`,
      { importId: `imp-template-${input}`, fileName: '计时核心训练.pdf' },
    );
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    await user.clear(await screen.findByTestId('ex-duration-0'));
    await user.type(screen.getByTestId('ex-duration-0'), input);
    await user.click(screen.getByRole('button', { name: /另存一份计划/ }));

    await waitFor(async () => {
      const saved = (await dbGetAll('plans')).find((plan) => plan.title === '计时核心训练（模板）');
      expect(saved?.exercises[0].target.durationText).toBe(expected);
      expect(saved?.exercises[0].target.durationSec).toBe(30);
      expect(saved?.exercises[0].target.durationPerSide).toBe(true);
      expect(saved?.exercises[0].target.reps).toBeNull();
    });
  });

  it('另存一份计划在时长清空或误填“次”时阻止保存', async () => {
    const draft = parsePlanText(
      `计时核心训练
日期：2026-09-15
1. 哥本哈根侧桥
2-3组 × 25-35秒/侧`,
      { importId: 'imp-template-invalid', fileName: '计时核心训练.pdf' },
    );
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    const duration = await screen.findByTestId('ex-duration-0');
    await user.clear(duration);
    await user.click(screen.getByRole('button', { name: /另存一份计划/ }));
    await screen.findByText(/时长不能为空/);
    expect((await dbGetAll('plans')).some((plan) => plan.title === '计时核心训练（模板）')).toBe(false);

    await user.type(duration, '30次');
    await user.click(screen.getByRole('button', { name: /另存一份计划/ }));
    await screen.findByText(/不要填写“次”/);
    expect((await dbGetAll('plans')).some((plan) => plan.title === '计时核心训练（模板）')).toBe(false);
  });

  it('时长清空或误填“次”时提示无效，不保存旧的 35 秒', async () => {
    const draft = parsePlanText(
      `计时核心训练
日期：2026-09-15
1. 哥本哈根侧桥
2-3组 × 25-35秒/侧`,
      { importId: 'imp-invalid-duration', fileName: '计时核心训练.pdf' },
    );
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    const duration = await screen.findByTestId('ex-duration-0');
    await user.clear(duration);
    await user.click(screen.getByRole('button', { name: /确认保存计划/ }));
    await screen.findByText(/时长不能为空/);
    expect((await dbGetAll('plans')).some((plan) => plan.title === '计时核心训练')).toBe(false);

    await user.type(duration, '30次');
    await user.click(screen.getByRole('button', { name: /确认保存计划/ }));
    await screen.findByText(/不要填写“次”/);
    expect((await dbGetAll('plans')).some((plan) => plan.title === '计时核心训练')).toBe(false);
  });

  it('查看已保存的旧结果不会自动新建，只有“复制为新计划”才创建副本', async () => {
    const now = '2026-09-15T00:00:00.000Z';
    const draft = parsePlanText(PLAN_TEXT, {
      importId: 'saved-plan-import',
      fileName: '下肢力量.pdf',
    });
    saveDraftToSession(draft);
    await dbPut('plans', {
      id: 'old-plan',
      title: '已经保存过的计划',
      date: '2026-09-15',
      kind: 'strength',
      source: 'pdf',
      warmup: [],
      exercises: [],
      createdAt: now,
      updatedAt: now,
    });
    await dbPut('pdfImports', {
      id: 'saved-plan-import',
      fileName: '下肢力量.pdf',
      fileSize: 1000,
      pageCount: 1,
      importedAt: now,
      kind: 'plan',
      pages: [],
      text: PLAN_TEXT,
      ocrRequired: false,
      saved: true,
      planId: 'old-plan',
    });

    const user = userEvent.setup();
    renderPage('/import/confirm?import=saved-plan-import');
    await screen.findByText(/这是上次已保存的导入结果/);
    expect(screen.queryByRole('button', { name: /确认保存计划/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /另存一份计划/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /复制为新计划/ }));
    await waitFor(async () => {
      const plans = await dbGetAll('plans');
      expect(plans).toHaveLength(2);
      const imports = await dbGetAll('pdfImports');
      expect(imports.find((row) => row.id === 'saved-plan-import')?.planId).toBe('old-plan');
    });
  });
});

describe('ImportConfirmPage - 周计划复查', () => {
  it('已保存周计划默认只读，显式复制后新增计划且保留旧 planId', async () => {
    const now = '2026-09-15T00:00:00.000Z';
    const { days, warnings } = parseWeeklyPlanBody(WEEKLY_TEXT, {
      importId: 'saved-week-import',
      fileName: '周计划.pdf',
    });
    const draft = {
      kind: 'weekly-plan' as const,
      importId: 'saved-week-import',
      fileName: '周计划.pdf',
      days,
      warnings,
    };
    saveDraftToSession(draft);
    await dbPut('plans', {
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
    await dbPut('pdfImports', {
      id: 'saved-week-import',
      fileName: '周计划.pdf',
      fileSize: 2000,
      pageCount: 1,
      importedAt: now,
      kind: 'weekly-plan',
      pages: [],
      text: WEEKLY_TEXT,
      ocrRequired: false,
      saved: true,
      planId: 'old-week-plan',
    });

    const user = userEvent.setup();
    renderPage('/import/confirm?import=saved-week-import');
    await screen.findByText(/这是上次已保存的导入结果/);
    expect(screen.queryByRole('button', { name: /保存所选/ })).toBeNull();
    expect(screen.getByRole('button', { name: /复制为新周计划/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /复制为新周计划/ }));
    await waitFor(async () => {
      const plans = await dbGetAll('plans');
      expect(plans.length).toBeGreaterThan(1);
      expect(plans.some((plan) => plan.id === 'old-week-plan')).toBe(true);
      const imports = await dbGetAll('pdfImports');
      expect(imports.find((row) => row.id === 'saved-week-import')?.planId).toBe('old-week-plan');
    });
  });
});

describe('ImportConfirmPage - 今日总结合并', () => {
  it('展示新增/修改差异，确认后按日期合并，且不删除原有字段', async () => {
    const existing: DailyLog = {
      id: '2026-09-14',
      date: '2026-09-14',
      weightKg: 72.4,
      trainingContent: '旧的下肢训练',
      note: '原有备注',
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    };
    // 预置一条计划，避免首次启动时自动注入示例数据干扰断言
    await dbPut('plans', {
      id: 'plan-existing',
      title: '已有计划',
      date: '2026-09-15',
      kind: 'strength',
      source: 'manual',
      warmup: [],
      exercises: [],
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
    await dbPut('dailyLogs', existing);

    const draft = parseSummaryText(SUMMARY_TEXT, { importId: 'imp-sum', fileName: '总结.pdf' });
    saveDraftToSession(draft);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/保存前的变更预览/);
    // 等 AppData 初始化完成后，差异面板会显示「修改」
    expect(await screen.findByText(/修改 \d+ 项/)).toBeTruthy();
    expect(screen.getByText('72.4 kg')).toBeTruthy(); // 旧值展示为删除线

    await user.click(screen.getByRole('button', { name: /确认合并保存/ }));

    await waitFor(async () => {
      const logs = await dbGetAll('dailyLogs');
      const merged = logs.find((l) => l.date === '2026-09-14');
      expect(merged?.weightKg).toBeCloseTo(71.6);
      expect(merged?.trainingContent).toContain('深蹲');
      expect(merged?.trainingVolumeKg).toBe(8420);
      expect(merged?.rpe).toBe(8);
      // 原有创建时间被保留（同一天的数据是合并而不是重建）
      expect(merged?.createdAt).toBe('2026-09-14T00:00:00.000Z');
    });
  });
});

describe('ImportConfirmPage - 扫描版 PDF', () => {
  it('明确提示需要 OCR，不假装识别成功', async () => {
    saveDraftToSession({
      kind: 'ocr',
      importId: 'imp-ocr',
      fileName: '扫描件.pdf',
      pageCount: 3,
      warnings: ['这是扫描版 PDF：没有文字层，无法直接识别。'],
    });
    renderPage();
    expect(await screen.findByText(/这是扫描版 PDF/)).toBeTruthy();
    expect(screen.getByText(/需要 OCR/)).toBeTruthy();
  });
});

describe('ImportConfirmPage - 没有草稿', () => {
  it('引导用户先去导入', async () => {
    renderPage();
    expect(await screen.findByText(/没有待确认的导入/)).toBeTruthy();
  });
});

describe('数据库隔离', () => {
  it('每次测试使用独立数据库名称（确保 fake-indexeddb 生效）', () => {
    expect(DB_NAME).toBe('wo-de-xun-lian');
  });
});
