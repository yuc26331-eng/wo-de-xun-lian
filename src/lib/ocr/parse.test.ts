import { describe, expect, it } from 'vitest';
import {
  mergeWatchAnalyses,
  normalizeOcrText,
  parseSleepText,
  parseWatchText,
} from './parse';

/** 模拟 Apple 健康 / 健身 App 中文截图被 OCR 出来的文字 */
const WATCH_CN = `
摘要
活动能量
620 千卡
锻炼
76 分钟
站立
11 小时
步数
9123 步
心率
平均 128 次/分
最高 176 次/分
静息 52 次/分
心率变异性
HRV 64 毫秒
血氧
97%
`;

const WATCH_EN = `
Summary
Active Energy
480 kcal
Exercise
32 min
Stand
9 hr
Steps
6100 steps
Heart Rate
Avg 118 bpm
Max 165 bpm
Resting 55 bpm
`;

describe('Apple Watch 截图文字解析', () => {
  // 这一份是「真实 tesseract 识别我们的测试截图」得到的原始输出，
  // 保留了 OCR 的典型瑕疵：汉字间插空格、单位被误识别（FF/%）、标签被误识别（FRE）。
  const WATCH_REAL_OCR = `活动 能 量

620 FF
锻炼

76 分钟
站 立

11 小 时
步 数

9123 %
心率
平均

128 次 /分
最 高

176 次 /分
FRE

52 次 /分
HRV

64 毫秒
血 氧

97%`;

  it('真实 OCR 输出（含空格与误识别单位）也能正确解析', () => {
    const a = parseWatchText(WATCH_REAL_OCR);
    expect(a.fields.activeEnergyKcal?.value).toBe(620);
    expect(a.fields.exerciseMinutes?.value).toBe(76);
    expect(a.fields.standHours?.value).toBe(11);
    expect(a.fields.steps?.value).toBe(9123);
    expect(a.fields.avgHr?.value).toBe(128);
    expect(a.fields.maxHr?.value).toBe(176);
    expect(a.fields.restingHr?.value).toBe(52);
    expect(a.fields.hrvMs?.value).toBe(64);
    expect(a.fields.bloodOxygenPct?.value).toBe(97);
  });

  it('同一个数值不会被填进两个字段（平均心率不会被当成静息心率）', () => {
    const a = parseWatchText(WATCH_REAL_OCR);
    expect(a.fields.avgHr?.value).not.toBe(a.fields.restingHr?.value);
    expect(a.fields.restingHr?.value).toBe(52);
  });

  it('识别中文截图里的活动能量/锻炼/站立/步数/心率/HRV/血氧', () => {
    const a = parseWatchText(WATCH_CN);
    expect(a.fields.activeEnergyKcal?.value).toBe(620);
    expect(a.fields.exerciseMinutes?.value).toBe(76);
    expect(a.fields.standHours?.value).toBe(11);
    expect(a.fields.steps?.value).toBe(9123);
    expect(a.fields.avgHr?.value).toBe(128);
    expect(a.fields.maxHr?.value).toBe(176);
    expect(a.fields.restingHr?.value).toBe(52);
    expect(a.fields.hrvMs?.value).toBe(64);
    expect(a.fields.bloodOxygenPct?.value).toBe(97);
    expect(a.warnings).toHaveLength(0);
  });

  it('识别英文截图（kcal / min / bpm / steps）', () => {
    const a = parseWatchText(WATCH_EN);
    expect(a.fields.activeEnergyKcal?.value).toBe(480);
    expect(a.fields.exerciseMinutes?.value).toBe(32);
    expect(a.fields.standHours?.value).toBe(9);
    expect(a.fields.steps?.value).toBe(6100);
    expect(a.fields.avgHr?.value).toBe(118);
    expect(a.fields.maxHr?.value).toBe(165);
    expect(a.fields.restingHr?.value).toBe(55);
  });

  it('标签与数值分行的截图也能识别（Apple 健康常见排版）', () => {
    const text = '活动能量\n584\n千卡\n锻炼\n41\n分钟';
    const a = parseWatchText(text);
    expect(a.fields.activeEnergyKcal?.value).toBe(584);
    expect(a.fields.exerciseMinutes?.value).toBe(41);
  });

  it('全角数字与异常数值被正确处理', () => {
    const a = parseWatchText('活动能量 ６２０ 千卡\n静息心率 ９９９ 次/分');
    expect(a.fields.activeEnergyKcal?.value).toBe(620);
    // 999 超出静息心率合理范围 → 不采信
    expect(a.fields.restingHr).toBeUndefined();
  });

  it('识别不到数据时给出明确警告，不编造数值', () => {
    const a = parseWatchText('今天天气不错\n随便写点东西');
    expect(Object.keys(a.fields)).toHaveLength(0);
    expect(a.warnings[0]).toContain('没有识别到可用的运动数据');
  });

  it('多张截图合并：同名指标取最大值，不重复累加，且识别重复截图', () => {
    const a1 = parseWatchText(WATCH_CN);
    const a2 = parseWatchText('活动能量 300 千卡\n锻炼 20 分钟');
    const dup = parseWatchText(WATCH_CN); // 与第一张完全相同
    const merged = mergeWatchAnalyses([a1, a2, dup]);
    expect(merged.merged.activeEnergyKcal).toBe(620); // 取最大而非 620+300
    expect(merged.merged.exerciseMinutes).toBe(76);
    expect(merged.duplicates).toBe(1);
    expect(merged.usedScreenshots).toBe(2);
    expect(merged.notes.join(' ')).toContain('不重复计算');
  });
});

describe('睡眠截图文字解析', () => {
  const SLEEP_CN = `
睡眠
7小时18分
23:50 - 07:10
核心 4小时12分
深度 1小时05分
REM 1小时30分
清醒 31分钟
`;

  it('识别总时长、各阶段与入睡/起床时间', () => {
    const s = parseSleepText(SLEEP_CN).sleep;
    expect(s.totalHours).toBeCloseTo(7.3, 1);
    expect(s.coreHours).toBeCloseTo(4.2, 1);
    expect(s.deepHours).toBeCloseTo(1.1, 1);
    expect(s.remHours).toBeCloseTo(1.5, 1);
    expect(s.awakeHours).toBeCloseTo(0.5, 1);
    // 23:50 在 07:10 之前入睡（跨零点），因此是上床/入睡时间
    expect(s.sleepTime).toBe('23:50');
    expect(s.bedTime).toBe('23:50');
    expect(s.wakeTime).toBe('07:10');
  });

  it('英文睡眠截图同样可用', () => {
    const s = parseSleepText('Sleep\n7h 20m\nDeep 1h 10m\nCore 4h 30m\nREM 1h 40m\nAwake 20m')
      .sleep;
    expect(s.totalHours).toBeCloseTo(7.3, 1);
    expect(s.deepHours).toBeCloseTo(1.2, 1);
    expect(s.coreHours).toBeCloseTo(4.5, 1);
    expect(s.remHours).toBeCloseTo(1.7, 1);
    expect(s.awakeHours).toBeCloseTo(0.3, 1);
  });

  it('没有识别到内容时给出警告而不是填 0', () => {
    const r = parseSleepText('一张和睡眠无关的图片');
    expect(Object.keys(r.sleep)).toHaveLength(0);
    expect(r.warnings[0]).toContain('没有识别到睡眠数据');
  });
});

describe('文本预处理', () => {
  it('全角转半角、去掉多余空格与竖线', () => {
    expect(normalizeOcrText('１２３：４５ ｜ ６７８')).toBe('123:45 678');
  });
});
