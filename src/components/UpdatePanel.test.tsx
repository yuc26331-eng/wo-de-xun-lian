import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdatePanel } from './UpdatePanel';

vi.mock('../lib/update/useUpdater', () => ({
  phaseLabel: () => ({ text: '已是最新版本', tone: 'green' }),
  useUpdater: () => ({
    state: {
      phase: 'idle',
      currentVersion: '1.5.0',
      currentBuild: 'abcdef123456',
      latest: null,
      lastCheckedAt: '2026-09-15T23:30:00.000Z',
      error: null,
      progress: 0,
      busy: false,
      canRollback: false,
    },
    check: vi.fn(),
    apply: vi.fn(),
    retry: vi.fn(),
    rollback: vi.fn(),
    leaveRollback: vi.fn(),
    rollbackActive: false,
  }),
}));

vi.mock('../lib/update/updater', () => ({
  consumeUpdateSuccess: () => null,
  isStandalone: () => false,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UpdatePanel', () => {
  it('日期和时间都使用同一个本地时间，不混用 UTC 日期', () => {
    vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(8);
    vi.spyOn(Date.prototype, 'getDate').mockReturnValue(16);
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(7);
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(30);
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-15T23:30:00.000Z');

    render(<UpdatePanel />);

    expect(screen.getByTestId('update-checked-at')).toHaveTextContent('2026年9月16日 07:30');
  });
});
