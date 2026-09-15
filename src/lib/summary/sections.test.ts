import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../types';
import { dailyLogHeadline, dailyProgress, flattenSection, normalizeDailyLog } from './sections';

const legacyLog: DailyLog = {
  id: '2026-09-14',
  date: '2026-09-14',
  // v1 扁平字段
  weightKg: 71.6,
  trainingContent: '下肢力量：深蹲 4×5@90kg',
  trainingVolumeKg: 8420,
  rpe: 8,
  sleepHours: 7.2,
  diet: '早餐燕麦鸡蛋，午餐米饭鸡胸',
  supplements: { proteinG: 50, creatineG: 5, proteinScoops: 2 },
  pain: '右膝轻微不适',
  feeling: '状态不错',
  fatigue: 4,
  note: '下次加 2.5kg',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
};

describe('今日总结分区模型', () => {
  it('把 v1 扁平字段自动映射到 v2 分区（旧数据不丢）', () => {
    const log = normalizeDailyLog(legacyLog, '2026-09-14');
    expect(log.training?.items).toBe(legacyLog.trainingContent);
    expect(log.training?.rpe).toBe(8);
    expect(log.training?.volumeKg).toBe(8420);
    expect(log.sleep?.totalHours).toBe(7.2);
    expect(log.body?.weightKg).toBe(71.6);
    expect(log.body?.fatigue).toBe(4);
    expect(log.body?.injuryPain).toBe('右膝轻微不适');
    expect(log.body?.overall).toBe('状态不错');
    expect(log.meals?.note).toBe('早餐燕麦鸡蛋，午餐米饭鸡胸');
    expect(log.supplements?.proteinG).toBe(50);
    expect(log.freeNote).toBe('下次加 2.5kg');
  });

  it('空日期返回可用的空记录模板', () => {
    const log = normalizeDailyLog(null, '2026-09-20');
    expect(log.id).toBe('2026-09-20');
    expect(log.date).toBe('2026-09-20');
    expect(dailyProgress(log).hasAny).toBe(false);
  });

  it('flattenSection 合并旧字段后用于导出口径', () => {
    const flat = flattenSection(legacyLog, 'body');
    expect(flat.weightKg).toBe(71.6);
    expect(flat.fatigue).toBe(4);
    const diet = flattenSection(legacyLog, 'diet');
    expect(diet.proteinG).toBe(50);
    expect(diet.note).toBe('早餐燕麦鸡蛋，午餐米饭鸡胸');
  });

  it('完成度：填写越多比例越高，且分区计数正确', () => {
    const empty = dailyProgress(null);
    expect(empty.ratio).toBe(0);

    const partly = dailyProgress(
      normalizeDailyLog(
        {
          ...legacyLog,
          training: { items: '下肢力量', rpe: 8 },
          watch: { steps: 9000 },
          sleep: { totalHours: 7.5 },
          body: { weightKg: 71 },
          meals: { breakfast: '燕麦' },
          freeNote: '状态不错',
        },
        '2026-09-14',
      ),
    );
    expect(partly.ratio).toBeGreaterThan(0.2);
    expect(partly.filled).toBeGreaterThan(empty.filled);
    const watch = partly.sections.find((s) => s.key === 'watch')!;
    expect(watch.filled).toBe(1);
    expect(watch.total).toBe(12);
  });

  it('摘要文字包含主要指标，没有记录时显示未记录', () => {
    expect(dailyLogHeadline(null)).toBe('未记录');
    const headline = dailyLogHeadline(normalizeDailyLog(legacyLog, '2026-09-14'));
    expect(headline).toContain('下肢力量');
    expect(headline).toContain('睡眠');
    expect(headline).toContain('体重');
  });
});
