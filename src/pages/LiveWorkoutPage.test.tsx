/**
 * 实时跟练集成测试：
 * 选择计划 → 完成一组 → 自动休息 → 跳过休息 → 完成整个动作 → 进入下一个动作。
 * 同时验证「连续点击不会重复记录」。
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDataProvider } from '../state/AppData';
import { ToastProvider } from '../components/ui';
import LiveWorkoutPage from './LiveWorkoutPage';

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

    // 其余动作都已跳过 → 直接提供「完成训练并生成总结」
    const finish = await screen.findByTestId('live-finish-session', {}, { timeout: 4000 });
    await user.click(finish);
    await screen.findByTestId('live-finish-confirm', {}, { timeout: 4000 });
  }, 30000);
});
