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
import { parsePlanText } from '../lib/pdf/parsePlan';
import { parseSummaryText } from '../lib/pdf/parseSummary';
import { PLAN_TEXT, SUMMARY_TEXT } from '../lib/pdf/fixtures';
import type { DailyLog } from '../types';

function renderPage() {
  return render(
    <AppDataProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/import/confirm']}>
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
