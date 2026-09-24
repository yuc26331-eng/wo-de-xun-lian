import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyLog, ISODate } from '../../types';
import { ToastProvider } from '../ui';
import { SummaryForm } from './SummaryForm';
import { SummaryWizard } from './SummaryWizard';

const appDataMocks = vi.hoisted(() => ({
  saveDailyLog: vi.fn(),
  saveBodyMetric: vi.fn(),
  deleteDailyLog: vi.fn(),
}));

vi.mock('../../state/AppData', () => ({
  useAppData: () => ({
    summaries: [],
    saveDailyLog: appDataMocks.saveDailyLog,
    saveBodyMetric: appDataMocks.saveBodyMetric,
    deleteDailyLog: appDataMocks.deleteDailyLog,
  }),
}));

const DATE = '2026-09-16' as ISODate;
const NEXT_DATE = '2026-09-17' as ISODate;
const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function renderForm() {
  return render(
    <ToastProvider>
      <SummaryForm date={DATE} log={null} />
    </ToastProvider>,
  );
}

function renderWizard() {
  return render(
    <ToastProvider>
      <SummaryWizard date={DATE} log={null} onOpenAdvanced={() => {}} />
    </ToastProvider>,
  );
}

describe('今日总结离开页面时的持久化', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appDataMocks.saveDailyLog.mockReset();
    appDataMocks.saveBodyMetric.mockReset();
    appDataMocks.deleteDailyLog.mockReset();
    appDataMocks.saveDailyLog.mockImplementation(async (log: DailyLog) => ({
      ...log,
      updatedAt: '2026-09-16T08:00:00.000Z',
    }));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('完整表单在 800ms 防抖完成前被 SPA 卸载时保存最新草稿', () => {
    const view = renderForm();
    const input = screen.getByTestId('summary-training-items');

    fireEvent.change(input, { target: { value: '旧内容' } });
    fireEvent.change(input, { target: { value: '离开前的最新内容' } });
    expect(appDataMocks.saveDailyLog).not.toHaveBeenCalled();

    view.unmount();

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(1);
    const saved = appDataMocks.saveDailyLog.mock.calls[0]?.[0] as DailyLog;
    expect(saved.training?.items).toBe('离开前的最新内容');
  });

  it('逐步引导在 700ms 防抖完成前被 SPA 卸载时保存最新训练卡片', () => {
    const view = renderWizard();

    fireEvent.click(screen.getByTestId('summary-start'));
    fireEvent.click(screen.getByTestId('session-add'));
    const input = screen.getByTestId('session-name-0');
    fireEvent.change(input, { target: { value: '旧训练名' } });
    fireEvent.change(input, { target: { value: '离开前的最新训练名' } });
    expect(appDataMocks.saveDailyLog).not.toHaveBeenCalled();

    view.unmount();

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(1);
    const saved = appDataMocks.saveDailyLog.mock.calls[0]?.[0] as DailyLog;
    expect(saved.training?.sessions?.[0]?.name).toBe('离开前的最新训练名');
    expect(saved.status).toBe('draft');
  });

  it('完整表单切换 date 时先保存旧日期草稿，且旧保存完成不会清掉新日期修改', async () => {
    let resolveOldSave: ((saved: DailyLog) => void) | undefined;
    appDataMocks.saveDailyLog.mockImplementationOnce(
      (log: DailyLog) =>
        new Promise<DailyLog>((resolve) => {
          resolveOldSave = () =>
            resolve({ ...log, updatedAt: '2026-09-16T08:00:00.000Z' });
        }),
    );
    const view = renderForm();
    const input = screen.getByTestId('summary-training-items');

    fireEvent.change(input, { target: { value: '旧日期第一版' } });
    fireEvent.change(input, { target: { value: '旧日期最终版' } });
    view.rerender(
      <ToastProvider>
        <SummaryForm date={NEXT_DATE} log={null} />
      </ToastProvider>,
    );

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(1);
    const oldDateSave = appDataMocks.saveDailyLog.mock.calls[0]?.[0] as DailyLog;
    expect(oldDateSave.date).toBe(DATE);
    expect(oldDateSave.training?.items).toBe('旧日期最终版');

    fireEvent.change(screen.getByTestId('summary-training-items'), {
      target: { value: '新日期尚未防抖保存' },
    });
    await act(async () => {
      resolveOldSave?.(oldDateSave);
      await Promise.resolve();
    });
    view.unmount();

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(2);
    const newDateSave = appDataMocks.saveDailyLog.mock.calls[1]?.[0] as DailyLog;
    expect(newDateSave.date).toBe(NEXT_DATE);
    expect(newDateSave.training?.items).toBe('新日期尚未防抖保存');
  });

  it('逐步引导切换 date 时把最新训练卡片保存到旧日期', () => {
    const view = renderWizard();

    fireEvent.click(screen.getByTestId('summary-start'));
    fireEvent.click(screen.getByTestId('session-add'));
    const input = screen.getByTestId('session-name-0');
    fireEvent.change(input, { target: { value: '旧日期训练第一版' } });
    fireEvent.change(input, { target: { value: '旧日期训练最终版' } });
    view.rerender(
      <ToastProvider>
        <SummaryWizard date={NEXT_DATE} log={null} onOpenAdvanced={() => {}} />
      </ToastProvider>,
    );

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(1);
    const saved = appDataMocks.saveDailyLog.mock.calls[0]?.[0] as DailyLog;
    expect(saved.date).toBe(DATE);
    expect(saved.training?.sessions?.[0]?.name).toBe('旧日期训练最终版');
    expect(screen.getByTestId('summary-start')).toBeInTheDocument();
  });

  it('完整表单只注册一个 visibilitychange 监听器，并用同一引用移除', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const view = renderForm();
    const input = screen.getByTestId('summary-training-items');

    fireEvent.change(input, { target: { value: '第一版' } });
    fireEvent.change(input, { target: { value: '第二版' } });
    fireEvent.change(input, { target: { value: '最终版' } });

    const visibilityAdds = addSpy.mock.calls.filter(([type]) => type === 'visibilitychange');
    expect(visibilityAdds).toHaveLength(1);
    const listener = visibilityAdds[0]?.[1];

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(appDataMocks.saveDailyLog).toHaveBeenCalledTimes(1);
    const saved = appDataMocks.saveDailyLog.mock.calls[0]?.[0] as DailyLog;
    expect(saved.training?.items).toBe('最终版');

    view.unmount();

    const visibilityRemoves = removeSpy.mock.calls.filter(
      ([type, callback]) => type === 'visibilitychange' && callback === listener,
    );
    expect(visibilityRemoves).toHaveLength(1);
  });
});
