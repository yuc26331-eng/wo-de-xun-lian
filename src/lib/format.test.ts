import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayLabel, formatDurationCN, formatPace, secPerKmToText } from './format';

afterEach(() => {
  vi.useRealTimers();
});

describe('日期显示', () => {
  it('正确区分昨天、今天与明天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 12));

    expect(dayLabel('2026-09-15')).toBe('昨天');
    expect(dayLabel('2026-09-16')).toBe('今天');
    expect(dayLabel('2026-09-17')).toBe('明天');
  });
});

describe('时长与配速进位', () => {
  it('分钟四舍五入到 60 时向小时进位', () => {
    expect(formatDurationCN(7_199)).toBe('2小时');
    expect(formatDurationCN(7_169)).toBe('1小时59分');
  });

  it('配速秒数四舍五入到 60 时向分钟进位', () => {
    expect(formatPace(1, 359.6)).toBe(`6'00"/km`);
    expect(secPerKmToText(359.6)).toBe('6:00');
  });
});
