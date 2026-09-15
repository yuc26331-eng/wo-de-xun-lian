import { describe, expect, it } from 'vitest';
import type { DailyLog, WorkoutSummary } from '../../types';
import {
  CHATGPT_PREAMBLE,
  DISCLAIMER,
  buildRangeData,
  buildRangeSummary,
  exportFileName,
  toJson,
  toMarkdown,
  toPlainText,
  type ExportContext,
  type ExportInclude,
} from './chatgptExport';
import { DEFAULT_INCLUDE } from './chatgptExport';

const summary: WorkoutSummary = {
  id: 'sum1',
  sessionId: 'sess1',
  planId: 'plan1',
  planTitle: '下肢力量 + 爆发力',
  kind: 'strength',
  date: '2026-09-15',
  startedAt: '2026-09-15T10:00:00.000Z',
  endedAt: '2026-09-15T11:16:00.000Z',
  totalDurationSec: 4560,
  completedExercises: ['杠铃深蹲', '罗马尼亚硬拉'],
  skippedExercises: ['箱式跳'],
  totalSets: 7,
  totalReps: 51,
  totalVolumeKg: 8420,
  completionRate: 0.67,
  cardio: [
    {
      kind: 'run',
      exerciseName: '400 米间歇跑',
      durationSec: 540,
      distanceKm: 2.4,
      paceText: "4'00\"/km",
      avgHr: 172,
      playMin: null,
    },
  ],
  bodyWeightKg: 71.4,
  rpe: 8,
  fatigue: 6,
  painSites: ['右膝'],
  feeling: '最后一组有点吃力，但动作质量保持住了',
  note: '下次深蹲加 2.5kg',
  createdAt: '2026-09-15T11:16:00.000Z',
};

const fullLog: DailyLog = {
  id: '2026-09-15',
  date: '2026-09-15',
  training: {
    kind: 'strength',
    items: '下肢力量',
    exercises: '杠铃深蹲 4组×5次 90kg',
    durationMin: 76,
    runDistanceKm: 2.4,
    runPaceText: "4'00\"/km",
    rpe: 8,
    completionPct: 67,
    feeling: '状态不错',
    matchPerformance: '未参加比赛',
    painSites: ['右膝'],
  },
  watch: {
    activeEnergyKcal: 620,
    totalEnergyKcal: 2400,
    steps: 9123,
    exerciseMinutes: 76,
    standHours: 11,
    avgHr: 128,
    maxHr: 176,
    restingHr: 52,
    hrRecovery: 28,
    hrvMs: 64,
    bloodOxygenPct: 97,
    note: '手表戴满全天',
  },
  sleep: {
    bedTime: '23:30',
    sleepTime: '23:50',
    wakeTime: '07:10',
    totalHours: 7.3,
    deepHours: 1.2,
    coreHours: 4.4,
    remHours: 1.5,
    awakeHours: 0.2,
    napMinutes: 20,
    quality: 4,
    note: '夜里醒了一次',
  },
  body: {
    weightKg: 71.4,
    bodyFatPct: 15.1,
    fatigue: 4,
    soreness: 3,
    mood: 4,
    appetite: 4,
    stress: 2,
    injuryPain: '右膝训练后轻微不适',
    recovery: 4,
    overall: '整体不错',
  },
  meals: {
    breakfast: '燕麦 + 鸡蛋',
    lunch: '米饭 + 鸡胸',
    dinner: '牛肉意面',
    snack: '酸奶',
    waterMl: 2600,
    note: '晚餐偏晚',
  },
  supplements: { proteinG: 50, proteinScoops: 2, creatineG: 5, caffeineMg: 120, others: '维生素 D' },
  freeNote: '右膝在深蹲最后两组有轻微不适，没有加重。',
  createdAt: '2026-09-15T20:00:00.000Z',
  updatedAt: '2026-09-15T20:00:00.000Z',
};

const ctx: ExportContext = {
  dailyLogs: [fullLog],
  summaries: [summary],
  bodyMetrics: [
    {
      id: '2026-09-10',
      date: '2026-09-10',
      weightKg: 72.0,
      createdAt: '',
      updatedAt: '',
    },
  ],
  attachments: [
    {
      id: 'att1',
      date: '2026-09-15',
      kind: 'watch',
      name: 'watch.png',
      type: 'image/png',
      size: 1024,
      createdAt: '',
    },
  ],
};

describe('导出给 ChatGPT：数据组装', () => {
  it('按日期从早到晚生成每一天，并标记缺失日期', () => {
    const days = buildRangeData('2026-09-10', '2026-09-16', ctx);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-09-10');
    expect(days[1].empty).toBe(true); // 没有记录的日期
    const target = days.find((d) => d.date === '2026-09-15')!;
    expect(target.empty).toBe(false);
    expect(target.summaries).toHaveLength(1);
    expect(target.watchShots).toBe(1);
  });

  it('范围汇总包含训练次数、时长、跑步距离、均值与缺失日期', () => {
    const days = buildRangeData('2026-09-10', '2026-09-16', ctx);
    const s = buildRangeSummary(days);
    expect(s.dayCount).toBe(7);
    expect(s.recordedDays).toBe(2); // 9-10 有体重记录，9-15 有完整记录
    expect(s.trainingCount).toBe(1);
    expect(s.strengthCount).toBe(1);
    expect(s.footballCount).toBe(0);
    expect(s.totalDurationSec).toBe(4560);
    expect(s.totalRunKm).toBeCloseTo(2.4, 2);
    expect(s.avgRpe).toBe(8);
    expect(s.avgSleepHours).toBeCloseTo(7.3, 2);
    expect(s.avgRestingHr).toBe(52);
    expect(s.avgHrv).toBe(64);
    expect(s.weightDelta).toBeCloseTo(-0.6, 2);
    expect(s.missingDates).toContain('2026-09-11');
    expect(s.painList.some((p) => p.text.includes('右膝'))).toBe(true);
  });

  it('没有记录的项目标记为未记录，不猜测数值', () => {
    const days = buildRangeData('2026-09-12', '2026-09-12', ctx);
    const md = toMarkdown(days, buildRangeSummary(days), DEFAULT_INCLUDE);
    expect(md).toContain('这一天没有任何记录。');
    expect(md).toContain('未记录');
    expect(md).not.toMatch(/步数：\d/);
  });
});

describe('Markdown / 纯文本 / JSON 输出', () => {
  const days = buildRangeData('2026-09-10', '2026-09-16', ctx);
  const sum = buildRangeSummary(days);

  it('Markdown 开头带指定说明，并按日期从早到晚分节', () => {
    const md = toMarkdown(days, sum, DEFAULT_INCLUDE);
    expect(md.startsWith('# 训练与恢复记录')).toBe(true);
    expect(md).toContain(CHATGPT_PREAMBLE);
    expect(md).toContain(DISCLAIMER);
    const i1 = md.indexOf('## 2026-09-10');
    const i2 = md.indexOf('## 2026-09-15');
    const i3 = md.indexOf('## 2026-09-16');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    // 六个分区标题
    for (const t of [
      '### 训练情况',
      '### Apple Watch 与运动数据',
      '### 睡眠情况',
      '### 身体与恢复',
      '### 饮食与补剂',
      '### 用户备注（原话）',
    ]) {
      expect(md).toContain(t);
    }
    // 保留原始数值、单位与用户原话
    expect(md).toContain('90kg');
    expect(md).toContain('7.3');
    expect(md).toContain('HRV：64 ms');
    expect(md).toContain('右膝在深蹲最后两组有轻微不适，没有加重。');
    expect(md).toContain('# 日期范围汇总');
    expect(md).toContain('总训练次数：1 次');
    expect(md).toContain('数据缺失日期：');
  });

  it('可以只导出选中的分区（隐私勾选）', () => {
    const include: ExportInclude = {
      training: true,
      watch: false,
      sleep: false,
      body: false,
      diet: false,
      notes: false,
    };
    const md = toMarkdown(days, sum, include);
    expect(md).toContain('### 训练情况');
    expect(md).not.toContain('### Apple Watch 与运动数据');
    expect(md).not.toContain('### 睡眠情况');
    expect(md).not.toContain('### 用户备注（原话）');
  });

  it('纯文本可读（去掉 Markdown 记号但保留内容）', () => {
    const txt = toPlainText(days, sum, DEFAULT_INCLUDE);
    expect(txt).not.toContain('###');
    expect(txt).not.toContain('## ');
    expect(txt).toContain('2026-09-15');
    expect(txt).toContain('总训练次数');
  });

  it('JSON 结构完整，可被解析', () => {
    const json = JSON.parse(toJson(days, sum, DEFAULT_INCLUDE)) as {
      range: { start: string; end: string };
      instruction: string;
      days: unknown[];
      summary: { trainingCount: number; missingDates: string[] };
    };
    expect(json.range.start).toBe('2026-09-10');
    expect(json.range.end).toBe('2026-09-16');
    expect(json.instruction).toBe(CHATGPT_PREAMBLE);
    expect(json.days).toHaveLength(7);
    expect(json.summary.trainingCount).toBe(1);
    expect(json.summary.missingDates.length).toBeGreaterThan(0);
  });

  it('文件名使用「训练与恢复记录_开始_结束」格式', () => {
    expect(exportFileName('2026-09-10', '2026-09-16', 'md')).toBe(
      '训练与恢复记录_2026-09-10_2026-09-16.md',
    );
    expect(exportFileName('2026-09-15', '2026-09-15', 'txt')).toBe(
      '训练与恢复记录_2026-09-15.txt',
    );
  });
});
