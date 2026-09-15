import { describe, expect, it } from 'vitest';
import { mapHistoryDay, mergeDailyLog } from './historyMap';
import type { HistoryBundleDay } from './historyBundle';
import type { DailyLog } from '../../types';

const NOW = '2026-09-16T08:00:00.000Z';

const DAY: HistoryBundleDay = {
  date: '2026-08-13',
  file: '2026-08-13_训练总结.pdf',
  title: '8月13日 · 足球运动员训练总结',
  training: {
    items: '上午功能性力量 + 下午户外足球 + 晚上功能性力量（三练）',
    exercises: '功能性力量：腿部 + 上肢',
    sessionCount: 3,
    sessionDurationsMin: [68.5, 100.7, 35.7],
    matchPerformance: '下午足球以调整为主',
    sessions: [
      { name: '上午功能性力量', kind: 'strength', durationMin: 68.5, kcal: 470, rpe: 7.0 },
      {
        name: '下午户外足球',
        kind: 'football',
        durationMin: 100.7,
        distanceKm: 4.11,
        kcal: 854,
        rpe: 7.5,
      },
      { name: '晚上功能性力量', kind: 'strength', durationMin: 35.7, kcal: 251, rpe: 7.3 },
    ],
  },
  watch: {
    activeEnergyKcal: 2536,
    exerciseMinutes: 230,
    steps: 16469,
    distanceKm: 13.45,
  },
  sleep: {
    totalHours: 5.78,
    remHours: 1.27,
    coreHours: 2.88,
    deepHours: 0.43,
    note: '手表记录 5 小时 47 分',
  },
  supplements: { proteinCups: 2, creatineCups: 1, note: '蛋白粉 2 杯 + 肌酸 1 份' },
  meals: { lunch: '米饭、鸡胸肉', dinner: '鸡肉、米饭' },
  scores: { training: 8.6, load: 8, recovery: 7 },
  fatigue10: 7.8,
  note: '三次训练累计约 3 小时 25 分钟，重点是累计恢复压力。',
  reportText: '（报告原文）',
  pdfBase64: btoa('%PDF-1.4 fake'),
  pdfSize: 1234,
};

describe('历史报告 → 每日总结映射', () => {
  const mapped = mapHistoryDay(DAY, NOW);

  it('按报告日期归档，不做"今天"处理', () => {
    expect(mapped.date).toBe('2026-08-13');
    expect(mapped.log.id).toBe('2026-08-13');
    expect(mapped.log.date).toBe('2026-08-13');
    expect(mapped.log.status).toBe('final');
    expect(mapped.log.source).toBe('pdf');
  });

  it('训练：场次、时长、项目都写进对应字段', () => {
    expect(mapped.log.training?.items).toContain('上午功能性力量');
    expect(mapped.log.training?.sessionCount).toBe(3);
    expect(mapped.log.training?.durationMin).toBe(204.9);
    expect(mapped.log.training?.sessionDurationsMin).toEqual([68.5, 100.7, 35.7]);
    expect(mapped.log.training?.sessions).toHaveLength(3);
    expect(mapped.log.training?.matchPerformance).toContain('调整');
  });

  it('报告没有的字段留空，不填 0、不编造', () => {
    expect(mapped.log.training?.volumeKg ?? null).toBeNull();
    expect(mapped.log.training?.completionPct ?? null).toBeNull();
    expect(mapped.log.body?.weightKg ?? null).toBeNull();
    expect(mapped.log.body?.bodyFatPct ?? null).toBeNull();
    expect(mapped.log.body?.fatigue ?? null).toBeNull();
    expect(mapped.log.body?.fatigue10).toBe(7.8);
    expect(mapped.log.sleep?.napMinutes ?? null).toBeNull();
    expect(mapped.log.watch?.avgHr ?? null).toBeNull();
    expect(mapped.log.watch?.distanceKm).toBe(13.45);
  });

  it('补剂按报告原单位保存（杯 / 份），不换算成克', () => {
    const list = mapped.log.supplementsList ?? [];
    expect(list.map((s) => `${s.name}${s.amount}${s.unit}`)).toEqual(['蛋白粉2杯', '肌酸1份']);
    expect(mapped.log.supplements?.proteinG ?? null).toBeNull();
    expect(mapped.log.supplements?.note).toContain('肌酸');
  });

  it('报告原文、评分与原始 PDF 都留档', () => {
    const rep = mapped.log.reportImports?.[0];
    expect(rep?.title).toContain('8月13日');
    expect(rep?.reportText).toContain('报告原文');
    expect(rep?.scores?.map((s) => s.label)).toEqual(['训练质量', '负荷控制', '恢复']);
    expect(rep?.attachmentId).toBe('hist-2026-08-13');
    expect(mapped.attachment?.meta.type).toBe('application/pdf');
    expect(mapped.log.attachmentIds).toEqual(['hist-2026-08-13']);
  });

  it('文字总结/建议进备注，不被丢掉', () => {
    expect(mapped.log.freeNote).toContain('累计恢复压力');
    expect(mapped.log.freeNote).toContain('报告评分');
    expect(mapped.log.freeNote).toContain('历史报告导入');
  });

  it('训练记录：每场训练一条，可被统计（次数 / 时长 / 距离 / RPE）', () => {
    expect(mapped.summaries).toHaveLength(3);
    const football = mapped.summaries.find((s) => s.kind === 'football')!;
    expect(football.date).toBe('2026-08-13');
    expect(football.totalDurationSec).toBe(Math.round(100.7 * 60));
    expect(football.cardio[0]?.distanceKm).toBe(4.11);
    expect(football.rpe).toBe(7.5);
    expect(football.totalVolumeKg).toBe(0);
    expect(football.note).toContain('报告未提供逐组重量/次数明细');
    // 未来计划/建议不会被写成已完成训练
    expect(mapped.summaries.every((s) => s.completedExercises.length === 0)).toBe(true);
  });
});

describe('同一天合并：只补空，不覆盖', () => {
  const mapped = mapHistoryDay(DAY, NOW);

  it('没有旧记录时直接按新记录写入', () => {
    const res = mergeDailyLog(mapped.log, null, NOW);
    expect(res.conflicts).toHaveLength(0);
    expect(res.log.date).toBe('2026-08-13');
  });

  it('旧记录已有数值时保留原值并列出冲突，空字段继续补', () => {
    const existing: DailyLog = {
      id: '2026-08-13',
      date: '2026-08-13',
      createdAt: '2026-08-13T10:00:00.000Z',
      updatedAt: '2026-08-13T10:00:00.000Z',
      status: 'final',
      sleep: { totalHours: 7.5, note: '我自己记的' },
      freeNote: '当天手写感受',
    };
    const res = mergeDailyLog(mapped.log, existing, NOW);

    // 冲突：睡眠总时长不一致 → 保留用户的原值
    expect(res.log.sleep?.totalHours).toBe(7.5);
    expect(res.conflicts.some((c) => c.label.includes('总睡眠'))).toBe(true);
    expect(res.conflicts[0].existing).toBe('7.5');
    expect(res.conflicts[0].incoming).toBe('5.78');
    // 没有冲突的部分继续导入
    expect(res.log.watch?.steps).toBe(16469);
    expect(res.log.training?.sessions).toHaveLength(3);
    expect(res.log.reportImports).toHaveLength(1);
    // 备注追加，不清空原有内容
    expect(res.log.freeNote).toContain('当天手写感受');
    expect(res.log.freeNote).toContain('历史报告导入');
    // 创建时间保持旧值
    expect(res.log.createdAt).toBe('2026-08-13T10:00:00.000Z');
    expect(res.log.updatedAt).toBe(NOW);
  });

  it('相同数据重复导入不会产生冲突（幂等）', () => {
    const first = mergeDailyLog(mapped.log, null, NOW);
    const second = mergeDailyLog(mapped.log, first.log, NOW);
    expect(second.conflicts).toHaveLength(0);
    expect(second.fills).toHaveLength(0);
    expect(second.log.reportImports).toHaveLength(1);
    expect(second.log.attachmentIds).toHaveLength(1);
    expect(second.log.supplementsList).toHaveLength(2);
  });
});
