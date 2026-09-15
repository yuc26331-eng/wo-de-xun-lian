/**
 * 训练进步统计（全部基于真实保存的训练记录，不填充任何假数据）
 *
 * 数据来源：
 * - WorkoutSummary 的汇总字段（次数 / 时长 / 容量）→ 本周、累计
 * - WorkoutSummary.exerciseSets（v1.1 起保存）→ 同一动作的重量 / 次数变化
 */
import type {
  ExerciseSetRecord,
  ISODate,
  WorkoutSummary,
} from '../types';
import { addDays, dayDiff, toISODate } from './format';

export interface RangeStats {
  sessions: number;
  durationSec: number;
  volumeKg: number;
  /** 有记录的最早 / 最晚日期 */
  firstDate: ISODate | null;
  lastDate: ISODate | null;
}

/** 最近 7 天（含今天）的训练统计 */
export function weekStats(summaries: WorkoutSummary[], today: ISODate = toISODate()): RangeStats {
  const start = addDays(today, -6);
  return rangeStats(summaries, start, today);
}

export function rangeStats(
  summaries: WorkoutSummary[],
  start: ISODate,
  end: ISODate,
): RangeStats {
  const rows = summaries.filter((s) => s.date >= start && s.date <= end);
  return {
    sessions: rows.length,
    durationSec: rows.reduce((n, s) => n + (s.totalDurationSec || 0), 0),
    volumeKg: rows.reduce((n, s) => n + (s.totalVolumeKg || 0), 0),
    firstDate: rows.length ? rows.reduce((a, b) => (a.date < b.date ? a : b)).date : null,
    lastDate: rows.length ? rows.reduce((a, b) => (a.date > b.date ? a : b)).date : null,
  };
}

/** 累计统计（全部历史） */
export function allTimeStats(summaries: WorkoutSummary[]): RangeStats {
  return {
    sessions: summaries.length,
    durationSec: summaries.reduce((n, s) => n + (s.totalDurationSec || 0), 0),
    volumeKg: summaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0),
    firstDate: summaries.length
      ? summaries.reduce((a, b) => (a.date < b.date ? a : b)).date
      : null,
    lastDate: summaries.length
      ? summaries.reduce((a, b) => (a.date > b.date ? a : b)).date
      : null,
  };
}

/** 连续打卡天数（今天没练则从昨天开始算） */
export function streakDays(summaries: WorkoutSummary[], today: ISODate = toISODate()): number {
  const days = new Set(summaries.map((s) => s.date));
  let cursor = today;
  if (!days.has(cursor)) {
    cursor = addDays(today, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* 同一动作的进步                                                       */
/* ------------------------------------------------------------------ */

export interface ExerciseProgressPoint {
  date: ISODate;
  /** 当日最大重量（没有重量记录时为 null） */
  topWeight: number | null;
  /** 当日单组最多次数 */
  maxReps: number | null;
  /** 当日总次数 */
  totalReps: number;
  /** 当日总容量 */
  volumeKg: number;
  /** 当日完成组数 */
  doneSets: number;
}

export interface ExerciseProgression {
  name: string;
  points: ExerciseProgressPoint[];
  /** 有重量数据的第一个 / 最后一个点 */
  firstWeight: ExerciseProgressPoint | null;
  lastWeight: ExerciseProgressPoint | null;
  weightDelta: number | null;
  /** 有次数数据的第一个 / 最后一个点 */
  firstReps: ExerciseProgressPoint | null;
  lastReps: ExerciseProgressPoint | null;
  repsDelta: number | null;
  trend: 'up' | 'down' | 'flat' | 'none';
}

const setDone = (set: ExerciseSetRecord['sets'][number]): boolean =>
  set.done !== false && (set.weightKg != null || set.reps != null || set.durationSec != null);

/** 汇总某份记录里某个动作的当日表现 */
function pointFrom(
  date: ISODate,
  entry: ExerciseSetRecord,
): ExerciseProgressPoint | null {
  const done = entry.sets.filter(setDone);
  if (!done.length) return null;
  const weights = done.map((s) => s.weightKg).filter((w): w is number => w != null && w > 0);
  const reps = done.map((s) => s.reps).filter((r): r is number => r != null && r > 0);
  const volumeKg = done.reduce((n, s) => n + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  return {
    date,
    topWeight: weights.length ? Math.max(...weights) : null,
    maxReps: reps.length ? Math.max(...reps) : null,
    totalReps: reps.reduce((n, r) => n + r, 0),
    volumeKg,
    doneSets: done.length,
  };
}

/** 某份记录里出现的全部动作名（含只有名字的旧记录） */
export function exerciseNamesIn(summary: WorkoutSummary): string[] {
  if (summary.exerciseSets?.length) {
    return summary.exerciseSets.map((e) => e.name);
  }
  return summary.completedExercises;
}

/** 训练过（按出现次数排序）的动作列表，用于选择器默认值 */
export function trainedExercises(
  summaries: WorkoutSummary[],
  limit = 20,
): { name: string; sessions: number; lastDate: ISODate }[] {
  const map = new Map<string, { name: string; sessions: number; lastDate: ISODate }>();
  for (const s of [...summaries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const name of new Set(exerciseNamesIn(s))) {
      const row = map.get(name) ?? { name, sessions: 0, lastDate: s.date };
      row.sessions += 1;
      row.lastDate = s.date;
      map.set(name, row);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.sessions - a.sessions || (a.lastDate < b.lastDate ? 1 : -1))
    .slice(0, limit);
}

/** 同一动作的进步曲线（按日期从早到晚） */
export function exerciseProgression(
  summaries: WorkoutSummary[],
  name: string,
): ExerciseProgression {
  const points: ExerciseProgressPoint[] = [];
  for (const s of [...summaries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const entry = s.exerciseSets?.find((e) => e.name === name);
    if (!entry) continue;
    const point = pointFrom(s.date, entry);
    if (point) points.push(point);
  }
  const withWeight = points.filter((p) => p.topWeight != null);
  const withReps = points.filter((p) => p.maxReps != null);
  const firstWeight = withWeight[0] ?? null;
  const lastWeight = withWeight[withWeight.length - 1] ?? null;
  const firstReps = withReps[0] ?? null;
  const lastReps = withReps[withReps.length - 1] ?? null;
  const weightDelta =
    firstWeight && lastWeight && firstWeight !== lastWeight
      ? Math.round(((lastWeight.topWeight ?? 0) - (firstWeight.topWeight ?? 0)) * 10) / 10
      : firstWeight
        ? 0
        : null;
  const repsDelta =
    firstReps && lastReps && firstReps !== lastReps
      ? (lastReps.maxReps ?? 0) - (firstReps.maxReps ?? 0)
      : firstReps
        ? 0
        : null;

  let trend: ExerciseProgression['trend'] = 'none';
  if (withWeight.length >= 2) {
    if ((weightDelta ?? 0) > 0) trend = 'up';
    else if ((weightDelta ?? 0) < 0) trend = 'down';
    else if ((repsDelta ?? 0) > 0) trend = 'up';
    else if ((repsDelta ?? 0) < 0) trend = 'down';
    else trend = 'flat';
  } else if (withWeight.length === 1) {
    trend = 'flat';
  }

  return {
    name,
    points,
    firstWeight,
    lastWeight,
    weightDelta,
    firstReps,
    lastReps,
    repsDelta,
    trend,
  };
}

/** 一条简洁的中文结论（没有数据时给出引导） */
export function progressionSummary(p: ExerciseProgression): string {
  if (!p.points.length) {
    return '还没有这个动作的记录：完成一次训练并在本机保存后，这里会显示变化。';
  }
  if (p.points.length === 1) {
    const only = p.points[0];
    return `目前只有 ${only.date} 一次记录${
      only.topWeight != null ? `（最大 ${only.topWeight}kg × ${only.maxReps ?? '—'} 次）` : ''
    }，再练一次就能看到变化。`;
  }
  if (p.weightDelta != null && p.weightDelta > 0) {
    return `最大重量从 ${p.firstWeight?.topWeight}kg 提升到 ${p.lastWeight?.topWeight}kg（+${p.weightDelta}kg）。`;
  }
  if (p.weightDelta != null && p.weightDelta < 0) {
    return `最大重量比首次记录低 ${Math.abs(p.weightDelta)}kg，可能是减量或状态波动。`;
  }
  if (p.repsDelta != null && p.repsDelta > 0) {
    return `重量持平，单组最多次数从 ${p.firstReps?.maxReps} 次增加到 ${p.lastReps?.maxReps} 次。`;
  }
  if (p.repsDelta != null && p.repsDelta < 0) {
    return `重量与次数略有下降（${p.repsDelta} 次），注意恢复。`;
  }
  return `重量与次数基本持平（最近 ${p.lastWeight?.topWeight ?? '—'}kg），可以尝试渐进超负荷。`;
}

/** 距离上次训练多少天（没有记录返回 null） */
export function daysSinceLastSession(
  summaries: WorkoutSummary[],
  today: ISODate = toISODate(),
): number | null {
  const last = allTimeStats(summaries).lastDate;
  if (!last) return null;
  return Math.max(0, dayDiff(today, last));
}
