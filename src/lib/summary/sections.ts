/**
 * 「今日总结」的分区模型
 * - 把 v1 的扁平字段自动映射到 v2 分区（旧数据不丢）
 * - 提供分区 / 每天的填写完成度，供首页与总结页显示进度
 */
import type {
  BodyRecovery,
  DailyLog,
  ISODate,
  MealLog,
  SleepData,
  SupplementLog,
  TrainingSection,
  WatchData,
} from '../../types';
import { nowISO } from '../format';

export type SectionKey = 'training' | 'watch' | 'sleep' | 'body' | 'diet' | 'notes';

export interface SectionMeta {
  key: SectionKey;
  label: string;
  emoji: string;
  /** 该分区用于计算完成度的关键字段 */
  fields: string[];
}

export const SECTIONS: SectionMeta[] = [
  {
    key: 'training',
    label: '训练记录',
    emoji: '🏋️',
    fields: [
      'kind',
      'items',
      'exercises',
      'durationMin',
      'runDistanceKm',
      'runPaceText',
      'rpe',
      'completionPct',
      'feeling',
      'matchPerformance',
      'painSites',
    ],
  },
  {
    key: 'watch',
    label: 'Apple Watch 与运动数据',
    emoji: '⌚️',
    fields: [
      'activeEnergyKcal',
      'totalEnergyKcal',
      'steps',
      'exerciseMinutes',
      'standHours',
      'distanceKm',
      'avgHr',
      'maxHr',
      'restingHr',
      'hrRecovery',
      'hrvMs',
      'bloodOxygenPct',
      'note',
    ],
  },
  {
    key: 'sleep',
    label: '睡眠记录',
    emoji: '😴',
    fields: [
      'bedTime',
      'sleepTime',
      'wakeTime',
      'totalHours',
      'deepHours',
      'coreHours',
      'remHours',
      'awakeHours',
      'napMinutes',
      'quality',
      'note',
    ],
  },
  {
    key: 'body',
    label: '身体与恢复状况',
    emoji: '🫀',
    fields: [
      'weightKg',
      'bodyFatPct',
      'fatigue10',
      'fatigue',
      'soreness',
      'mood',
      'appetite',
      'stress',
      'injuryPain',
      'recovery',
      'overall',
    ],
  },
  {
    key: 'diet',
    label: '饮食和补剂',
    emoji: '🥗',
    fields: [
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'waterMl',
      'proteinG',
      'creatineG',
      'caffeineMg',
      'others',
      'supplementsList',
      'noSupplements',
      'note',
    ],
  },
  {
    key: 'notes',
    label: '当日自由记录',
    emoji: '📝',
    fields: ['freeNote'],
  },
];

const isFilled = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

/** 取分区字段（合并 v1 旧字段），界面完成度与导出都用这一份口径 */
export function flattenSection(
  log: DailyLog | null | undefined,
  key: SectionKey,
): Record<string, unknown> {
  if (!log) return {};
  switch (key) {
    case 'training':
      return { ...log.training, volumeKg: log.training?.volumeKg ?? log.trainingVolumeKg ?? null };
    case 'watch':
      return { ...log.watch };
    case 'sleep':
      return { ...log.sleep, totalHours: log.sleep?.totalHours ?? log.sleepHours ?? null };
    case 'body':
      return {
        ...log.body,
        weightKg: log.body?.weightKg ?? log.weightKg ?? null,
        fatigue: log.body?.fatigue ?? log.fatigue ?? null,
        injuryPain: log.body?.injuryPain ?? log.pain ?? '',
        overall: log.body?.overall ?? log.feeling ?? '',
      };
    case 'diet':
      return {
        ...log.meals,
        proteinG: log.supplements?.proteinG ?? null,
        proteinScoops: log.supplements?.proteinScoops ?? null,
        creatineG: log.supplements?.creatineG ?? null,
        caffeineMg: log.supplements?.caffeineMg ?? null,
        others: log.supplements?.others ?? '',
        supplementNote: log.supplements?.note ?? '',
        supplementsList: (log.supplementsList ?? []).map(
          (s) => `${s.name}${s.amount ? ` ${s.amount}${s.unit ?? ''}` : ''}`,
        ),
        noSupplements: log.noSupplements ? '今天没吃补剂' : null,
        note: log.meals?.note ?? log.diet ?? '',
      };
    case 'notes':
      return { freeNote: log.freeNote ?? log.note ?? '' };
    default:
      return {};
  }
}

export interface SectionProgress {
  key: SectionKey;
  label: string;
  emoji: string;
  filled: number;
  total: number;
  /** 0~1 */
  ratio: number;
}

export function sectionProgress(
  log: DailyLog | null | undefined,
  key: SectionKey,
): SectionProgress {
  const meta = SECTIONS.find((s) => s.key === key)!;
  const flat = flattenSection(log, key);
  const filled = meta.fields.filter((f) => isFilled(flat[f])).length;
  const total = meta.fields.length;
  return {
    key,
    label: meta.label,
    emoji: meta.emoji,
    filled,
    total,
    ratio: total ? filled / total : 0,
  };
}

export interface DailyProgress {
  sections: SectionProgress[];
  filled: number;
  total: number;
  /** 0~1 总体完成度 */
  ratio: number;
  hasAny: boolean;
}

export function dailyProgress(log: DailyLog | null | undefined): DailyProgress {
  const sections = SECTIONS.map((s) => sectionProgress(log, s.key));
  const filled = sections.reduce((n, s) => n + s.filled, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return { sections, filled, total, ratio: total ? filled / total : 0, hasAny: filled > 0 };
}

/** 把 v1 扁平字段补进 v2 分区，返回新对象（不修改原记录） */
export function normalizeDailyLog(log: DailyLog | null, date: ISODate): DailyLog {
  const base: DailyLog = log
    ? { ...log }
    : { id: date, date, createdAt: nowISO(), updatedAt: nowISO() };

  const training: TrainingSection = {
    ...base.training,
    rpe: base.training?.rpe ?? base.rpe ?? null,
    items: base.training?.items ?? base.trainingContent ?? '',
    feeling: base.training?.feeling ?? base.feeling ?? '',
    volumeKg: base.training?.volumeKg ?? base.trainingVolumeKg ?? null,
  };
  const sleep: SleepData = {
    ...base.sleep,
    totalHours: base.sleep?.totalHours ?? base.sleepHours ?? null,
  };
  const body: BodyRecovery = {
    ...base.body,
    weightKg: base.body?.weightKg ?? base.weightKg ?? null,
    fatigue: base.body?.fatigue ?? base.fatigue ?? null,
    injuryPain: base.body?.injuryPain ?? base.pain ?? '',
    overall: base.body?.overall ?? base.feeling ?? '',
  };
  const meals: MealLog = { ...base.meals, note: base.meals?.note ?? base.diet ?? '' };
  const supplements: SupplementLog = { ...base.supplements };
  const watch: WatchData = { ...base.watch };

  return {
    ...base,
    training,
    sleep,
    body,
    meals,
    supplements,
    watch,
    freeNote: base.freeNote ?? base.note ?? '',
  };
}

/** 列表 / 首页用的简短摘要 */
export function dailyLogHeadline(log: DailyLog | null): string {
  if (!log) return '未记录';
  const parts: string[] = [];
  const training = flattenSection(log, 'training');
  if (isFilled(training.items) || isFilled(training.kind)) {
    parts.push(String(training.items || training.kind));
  }
  const sleep = flattenSection(log, 'sleep');
  if (isFilled(sleep.totalHours)) parts.push(`睡眠 ${sleep.totalHours} 小时`);
  const body = flattenSection(log, 'body');
  if (isFilled(body.weightKg)) parts.push(`体重 ${body.weightKg}kg`);
  const watch = flattenSection(log, 'watch');
  if (isFilled(watch.steps)) parts.push(`${watch.steps} 步`);
  return parts.length ? parts.join(' · ') : '已记录';
}
