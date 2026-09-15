import { describe, expect, it } from 'vitest';
import type { ExerciseSetRecord, WorkoutSummary } from '../types';
import {
  allTimeStats,
  daysSinceLastSession,
  exerciseProgression,
  progressionSummary,
  streakDays,
  trainedExercises,
  weekStats,
} from './progress';

function ex(
  name: string,
  sets: { weightKg: number | null; reps: number | null; done?: boolean }[],
): ExerciseSetRecord {
  return {
    name,
    kind: 'strength',
    status: 'done',
    doneSets: sets.filter((s) => s.done !== false).length,
    plannedSets: sets.length,
    sets: sets.map((s, i) => ({
      index: i + 1,
      weightKg: s.weightKg,
      reps: s.reps,
      done: s.done !== false,
    })),
  };
}

function summary(
  date: string,
  opts: {
    durationSec?: number;
    volumeKg?: number;
    exerciseSets?: ExerciseSetRecord[];
    completed?: string[];
  } = {},
): WorkoutSummary {
  return {
    id: `sum-${date}`,
    sessionId: `sess-${date}`,
    planId: 'plan',
    planTitle: '下肢力量',
    kind: 'strength',
    date,
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    totalDurationSec: opts.durationSec ?? 3600,
    completedExercises: opts.completed ?? (opts.exerciseSets ?? []).map((e) => e.name),
    skippedExercises: [],
    totalSets: 4,
    totalReps: 20,
    totalVolumeKg: opts.volumeKg ?? 0,
    completionRate: 1,
    cardio: [],
    exerciseSets: opts.exerciseSets,
    createdAt: `${date}T11:00:00.000Z`,
  };
}

describe('本周与累计统计', () => {
  const rows = [
    summary('2026-09-08', { durationSec: 3000, volumeKg: 5000 }),
    summary('2026-09-10', { durationSec: 3600, volumeKg: 6000 }),
    summary('2026-09-15', { durationSec: 4200, volumeKg: 7000 }),
  ];

  it('本周只统计最近 7 天（含今天）', () => {
    const week = weekStats(rows, '2026-09-15');
    expect(week.sessions).toBe(2); // 9-10 与 9-15
    expect(week.durationSec).toBe(7800);
    expect(week.volumeKg).toBe(13000);
  });

  it('累计统计覆盖全部历史', () => {
    const all = allTimeStats(rows);
    expect(all.sessions).toBe(3);
    expect(all.durationSec).toBe(10800);
    expect(all.volumeKg).toBe(18000);
    expect(all.firstDate).toBe('2026-09-08');
    expect(all.lastDate).toBe('2026-09-15');
  });

  it('没有训练记录时返回 0，不做假数据', () => {
    const empty = allTimeStats([]);
    expect(empty).toMatchObject({ sessions: 0, durationSec: 0, volumeKg: 0 });
    expect(empty.firstDate).toBeNull();
    expect(weekStats([], '2026-09-15').sessions).toBe(0);
    expect(streakDays([], '2026-09-15')).toBe(0);
    expect(daysSinceLastSession([], '2026-09-15')).toBeNull();
  });

  it('连续打卡与距上次训练天数', () => {
    expect(streakDays(rows, '2026-09-15')).toBe(1); // 9-15 有，9-14 没有
    const consecutive = [summary('2026-09-13'), summary('2026-09-14'), summary('2026-09-15')];
    expect(streakDays(consecutive, '2026-09-15')).toBe(3);
    expect(daysSinceLastSession(rows, '2026-09-17')).toBe(2);
  });
});

describe('同一动作的进步', () => {
  const rows = [
    summary('2026-09-01', {
      exerciseSets: [
        ex('杠铃深蹲', [
          { weightKg: 80, reps: 5 },
          { weightKg: 80, reps: 5 },
        ]),
      ],
    }),
    summary('2026-09-08', {
      exerciseSets: [
        ex('杠铃深蹲', [
          { weightKg: 85, reps: 5 },
          { weightKg: 85, reps: 4 },
        ]),
      ],
    }),
    summary('2026-09-15', {
      exerciseSets: [
        ex('杠铃深蹲', [
          { weightKg: 90, reps: 5 },
          { weightKg: 90, reps: 5 },
        ]),
      ],
    }),
  ];

  it('按日期从早到晚汇总最大重量、最多次数、总容量', () => {
    const p = exerciseProgression(rows, '杠铃深蹲');
    expect(p.points.map((x) => x.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15']);
    expect(p.points[0].topWeight).toBe(80);
    expect(p.points[0].maxReps).toBe(5);
    expect(p.points[0].volumeKg).toBe(800);
    expect(p.points[2].topWeight).toBe(90);
    expect(p.weightDelta).toBe(10);
    expect(p.trend).toBe('up');
    expect(progressionSummary(p)).toContain('提升到 90kg');
  });

  it('重量持平但次数增加也算进步', () => {
    const rows2 = [
      summary('2026-09-01', { exerciseSets: [ex('卧推', [{ weightKg: 60, reps: 8 }])] }),
      summary('2026-09-08', { exerciseSets: [ex('卧推', [{ weightKg: 60, reps: 10 }])] }),
    ];
    const p = exerciseProgression(rows2, '卧推');
    expect(p.weightDelta).toBe(0);
    expect(p.repsDelta).toBe(2);
    expect(p.trend).toBe('up');
    expect(progressionSummary(p)).toContain('次数');
  });

  it('没有完成的组不计入统计', () => {
    const rows3 = [
      summary('2026-09-01', {
        exerciseSets: [
          ex('硬拉', [
            { weightKg: 100, reps: 5 },
            { weightKg: 120, reps: 3, done: false },
          ]),
        ],
      }),
    ];
    const p = exerciseProgression(rows3, '硬拉');
    expect(p.points[0].topWeight).toBe(100);
    expect(p.points[0].doneSets).toBe(1);
  });

  it('只有一次记录时给出继续记录的引导', () => {
    const p = exerciseProgression([rows[0]], '杠铃深蹲');
    expect(p.points).toHaveLength(1);
    expect(progressionSummary(p)).toContain('再练一次');
  });

  it('没有记录时不编造数据', () => {
    const p = exerciseProgression(rows, '不存在的动作');
    expect(p.points).toHaveLength(0);
    expect(p.weightDelta).toBeNull();
    expect(progressionSummary(p)).toContain('还没有这个动作的记录');
  });

  it('旧记录（没有 exerciseSets）只按动作名统计，不假装有重量数据', () => {
    const legacy = [summary('2026-09-01', { completed: ['杠铃深蹲'] })];
    const p = exerciseProgression(legacy, '杠铃深蹲');
    expect(p.points).toHaveLength(0);
    const list = trainedExercises(legacy);
    expect(list.map((x) => x.name)).toContain('杠铃深蹲');
    expect(list[0].sessions).toBe(1);
  });

  it('动作列表按出现次数排序，供选择器使用', () => {
    const list = trainedExercises(rows);
    expect(list[0]).toMatchObject({ name: '杠铃深蹲', sessions: 3, lastDate: '2026-09-15' });
  });
});
