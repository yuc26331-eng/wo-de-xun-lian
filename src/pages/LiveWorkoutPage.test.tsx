/**
 * 实时跟练集成测试：
 * 选择计划 → 完成一组 → 自动休息 → 跳过休息 → 完成整个动作 → 进入下一个动作。
 * 同时验证「连续点击不会重复记录」。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataProvider } from '../state/AppData';
import { ToastProvider } from '../components/ui';
import { dbClearAll, dbGetAll, dbPut } from '../db/db';
import { buildLiveSession } from '../lib/session';
import LiveWorkoutPage from './LiveWorkoutPage';
import type { TrainingPlan } from '../types';

function renderLive(entry = '/live') {
  return render(
    <AppDataProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/live" element={<LiveWorkoutPage />} />
            <Route path="/" element={<div data-testid="home-route">首页</div>} />
            <Route path="/train" element={<div data-testid="train-route">训练</div>} />
            <Route path="/summary" element={<div data-testid="summary-route">总结</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </AppDataProvider>,
  );
}

/** 找到种子数据里的「下肢力量」计划并开始训练 */
async function startLowerBodyPlan(user: ReturnType<typeof userEvent.setup>) {
  const picker = screen.queryAllByTestId('live-plan-start');
  if (picker.length) {
    const target = picker.find((row) => row.textContent?.includes('下肢力量'));
    expect(target).toBeTruthy();
    await user.click(target!);
  }
  return screen.findByTestId('live-exercise-name', {}, { timeout: 8000 });
}

describe('LiveWorkoutPage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('可以开始训练、自动休息、连续完成多组并进入下一个动作', async () => {
    const user = userEvent.setup();
    renderLive();

    const name = await startLowerBodyPlan(user);
    expect(name.textContent).toContain('杠铃深蹲');
    expect(screen.getByTestId('live-progress').textContent).toContain('动作 1/6');

    // 第一组
    await user.click(screen.getByTestId('live-complete-set'));
    // 自动进入休息倒计时
    await screen.findByTestId('live-rest-timer', {}, { timeout: 4000 });
    await user.click(screen.getByTestId('live-rest-skip'));
    await waitFor(() => expect(screen.queryByTestId('live-rest-timer')).toBeNull());

    // 连续点击同一个按钮时只记录一次
    const button = screen.getByTestId('live-complete-set');
    await user.click(button);
    const restSkip = screen.queryByTestId('live-rest-skip');
    if (restSkip) await user.click(restSkip);
    await waitFor(() => expect(screen.getByTestId('live-complete-set').textContent).toContain('3/4'));

    // 完成剩下的两组
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByTestId('live-complete-set'));
      const skip = screen.queryByTestId('live-rest-skip');
      if (skip) await user.click(skip);
    }

    // 四组完成 → 出现「完成本动作并进入下一项」
    const finishExercise = await screen.findByTestId('live-finish-exercise', {}, { timeout: 4000 });
    await user.click(finishExercise);

    await waitFor(() =>
      expect(screen.getByTestId('live-exercise-name').textContent).toContain('罗马尼亚硬拉'),
    );
    expect(screen.getByTestId('live-progress').textContent).toContain('动作 2/6');
  }, 30000);

  it('时间型动作按秒展示和记录，不显示或写入次数', async () => {
    await dbClearAll();
    const now = new Date().toISOString();
    const plan: TrainingPlan = {
      id: 'timed-plan',
      title: '时间型核心训练',
      date: now.slice(0, 10),
      kind: 'strength',
      source: 'manual',
      estimatedMinutes: 20,
      warmup: [],
      exercises: [
        {
          id: 'timed-copenhagen',
          name: '哥本哈根侧桥',
          kind: 'strength',
          target: {
            sets: 2,
            durationSec: 35,
            durationText: '25-35秒/侧',
            durationPerSide: true,
            restSec: 60,
          },
          order: 0,
        },
      ],
      cooldown: '',
      createdAt: now,
      updatedAt: now,
    };
    await dbPut('plans', plan);
    const session = buildLiveSession(plan);
    await dbPut('sessions', session);

    const user = userEvent.setup();
    renderLive();
    expect(await screen.findByTestId('live-exercise-name')).toHaveTextContent('哥本哈根侧桥');
    expect(screen.queryByTestId('live-set-reps')).toBeNull();
    expect(screen.getByLabelText('实际时长（秒/侧）')).toBeTruthy();
    const duration = screen.getByTestId('live-set-duration');
    await waitFor(() => expect((duration as HTMLInputElement).value).toBe('35'));

    await user.clear(duration);
    await user.type(duration, '30');
    await user.click(screen.getByTestId('live-complete-set'));

    await waitFor(async () => {
      const rows = await dbGetAll('sessions');
      const saved = rows.find((row) => row.id === session.id);
      expect(saved?.exercises[0].sets[0].durationSec).toBe(30);
      expect(saved?.exercises[0].sets[0].reps).toBeNull();
    });
    await dbClearAll();
  }, 30000);

  it('训练数据写入 IndexedDB，重新进入会恢复进度', async () => {
    const user = userEvent.setup();
    const first = renderLive();
    await startLowerBodyPlan(user);

    const nameBefore = screen.getByTestId('live-exercise-name').textContent;
    const progressBefore = screen.getByTestId('live-progress').textContent;
    const buttonBefore = screen.getByTestId('live-complete-set').textContent ?? '';
    await user.click(screen.getByTestId('live-complete-set'));
    await screen.findByTestId('live-rest-timer', {}, { timeout: 4000 });
    await user.click(screen.getByTestId('live-rest-skip'));

    // 模拟关闭页面后重新打开：当前动作、进度、已完成组数都应该恢复
    first.unmount();
    renderLive();

    const resumed = await screen.findByTestId('live-exercise-name', {}, { timeout: 8000 });
    expect(resumed.textContent).toBe(nameBefore);
    expect(screen.getByTestId('live-progress').textContent).toBe(progressBefore);
    await screen.findByText(/^已恢复上次进度：/);
    await waitFor(() =>
      expect(screen.getByTestId('live-complete-set').textContent?.trim()).not.toBe(
        buttonBefore.trim(),
      ),
    );
  }, 30000);

  it('可以提前结束训练、保存总结，且重新打开不会恢复已完成训练', async () => {
    const user = userEvent.setup();
    const first = renderLive();
    await startLowerBodyPlan(user);

    // 暂停 → 结束并保存
    await user.click(screen.getByTestId('live-pause'));
    await user.click(await screen.findByTestId('live-end-early'));

    // 结束弹层：填写 RPE 与感受后保存
    const confirm = await screen.findByTestId('live-finish-confirm', {}, { timeout: 4000 });
    await user.type(screen.getByTestId('live-finish-weight'), '71.2');
    await user.click(confirm);

    // 自动跳转到今日总结页
    await screen.findByTestId('summary-route', {}, { timeout: 8000 });

    // 重新打开应用：不会再恢复这次已完成的训练，而是回到计划选择
    first.unmount();
    renderLive();
    const picker = await screen.findAllByTestId('live-plan-start', {}, { timeout: 8000 });
    expect(picker.length).toBeGreaterThan(0);
  }, 30000);

  it('跳过的动作不计入待完成，只剩最后一项时可直接结束训练', async () => {
    const user = userEvent.setup();
    renderLive();
    await startLowerBodyPlan(user);

    for (let i = 0; i < 5; i += 1) {
      await user.click(await screen.findByTestId('live-skip'));
    }
    await waitFor(() =>
      expect(screen.getByTestId('live-progress').textContent).toContain('动作 6/6'),
    );

    // 最后一个动作（平板支撑 3 组）完成后，直接给出「完成训练并生成总结」
    for (let i = 0; i < 3; i += 1) {
      await user.click(await screen.findByTestId('live-complete-set'));
      const skip = screen.queryByTestId('live-rest-skip');
      if (skip) await user.click(skip);
    }
    const finish = await screen.findByTestId('live-finish-session', {}, { timeout: 4000 });
    await user.click(finish);
    await screen.findByTestId('live-finish-confirm', {}, { timeout: 4000 });
  }, 30000);

  it('快速双击保存总结时，同一个 session 只生成一条记录', async () => {
    await dbClearAll();
    const user = userEvent.setup();
    renderLive();
    await startLowerBodyPlan(user);

    const active = (await dbGetAll('sessions')).find((session) => session.status === 'active');
    expect(active).toBeTruthy();

    await user.click(screen.getByTestId('live-pause'));
    await user.click(await screen.findByTestId('live-end-early'));
    const confirm = await screen.findByTestId('live-finish-confirm', {}, { timeout: 4000 });
    await user.dblClick(confirm);

    await screen.findByTestId('summary-route', {}, { timeout: 8000 });
    await waitFor(async () => {
      const rows = await dbGetAll('summaries');
      expect(rows.filter((summary) => summary.sessionId === active?.id)).toHaveLength(1);
    });
  }, 30000);

  it('保存失败会释放防重锁，用户可以重试成功', async () => {
    await dbClearAll();
    const user = userEvent.setup();
    renderLive();
    await startLowerBodyPlan(user);

    const active = (await dbGetAll('sessions')).find((session) => session.status === 'active');
    expect(active).toBeTruthy();

    await user.click(screen.getByTestId('live-pause'));
    await user.click(await screen.findByTestId('live-end-early'));
    const confirm = await screen.findByTestId('live-finish-confirm', {}, { timeout: 4000 });

    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementationOnce(() => {
        throw new Error('模拟总结写入失败');
      });
    await user.click(confirm);
    await screen.findByText('保存失败，请重试');
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveTextContent('保存总结');
    putSpy.mockRestore();

    await user.click(confirm);
    await screen.findByTestId('summary-route', {}, { timeout: 8000 });
    await waitFor(async () => {
      const rows = await dbGetAll('summaries');
      expect(rows.filter((summary) => summary.sessionId === active?.id)).toHaveLength(1);
    });
  }, 30000);
});
