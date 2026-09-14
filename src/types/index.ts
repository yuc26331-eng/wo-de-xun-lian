/**
 * 我的训练 —— 领域模型（全项目共享契约）
 * 任何模块都以这里的类型为准，不要各自定义重复类型。
 */

/** 'YYYY-MM-DD' */
export type ISODate = string;
/** 完整 ISO 时间戳 */
export type ISODateTime = string;

/** 训练类型 */
export type SessionKind =
  | 'strength'
  | 'run'
  | 'ride'
  | 'football'
  | 'stretch'
  | 'recovery'
  | 'other';

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  strength: '力量训练',
  run: '跑步',
  ride: '骑行',
  football: '足球',
  stretch: '拉伸',
  recovery: '恢复',
  other: '其他',
};

/** 导入来源 */
export type DataSource = 'manual' | 'pdf' | 'template' | 'sample';

/** 一个动作/一项训练的目标要求 */
export interface TargetSpec {
  /** 目标组数 */
  sets?: number | null;
  /** 次数，可能是区间，如 '8-12' */
  reps?: string | null;
  /** 建议重量（kg） */
  weightKg?: number | null;
  /** 无法转成数字的重量描述，如 '空杆'、'60% 1RM' */
  weightText?: string | null;
  /** 组间休息（秒） */
  restSec?: number | null;
  /** RPE 要求 */
  rpe?: number | null;
  rpeText?: string | null;
  /** 节奏，如 '3-1-1' */
  tempo?: string | null;
  /** 时间型目标（秒）：平板支撑、跑步时长等 */
  durationSec?: number | null;
  /** 距离（km） */
  distanceKm?: number | null;
  /** 配速描述，如 '5:30/km' */
  paceText?: string | null;
  /** 速度（km/h） */
  speedKph?: number | null;
  /** 目标心率（bpm） */
  hrBpm?: number | null;
  /** 足球上场时间（分钟） */
  playMin?: number | null;
}

/** 计划里的一个动作 */
export interface ExerciseItem {
  id: string;
  name: string;
  kind: SessionKind;
  /** 动作要领 */
  cue?: string;
  /** 注意事项 */
  notes?: string;
  target: TargetSpec;
  order: number;
  /** 超集/组合标记，同字母为一组 */
  superset?: string | null;
}

/** 热身内容 */
export interface WarmupItem {
  name: string;
  detail?: string;
  durationSec?: number | null;
}

/** 训练计划 */
export interface TrainingPlan {
  id: string;
  title: string;
  /** 计划日期，未识别为 null */
  date: ISODate | null;
  kind: SessionKind;
  source: DataSource;
  sourceFile?: string;
  /** 预计训练时间（分钟） */
  estimatedMinutes?: number | null;
  warmup: WarmupItem[];
  exercises: ExerciseItem[];
  /** 拉伸及恢复安排 */
  cooldown?: string;
  notes?: string;
  archived?: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* 实时跟练                                                            */
/* ------------------------------------------------------------------ */

export interface SetRecord {
  id: string;
  /** 第几组，从 1 开始 */
  index: number;
  weightKg: number | null;
  reps: number | null;
  /** 时间型：实际秒数 */
  durationSec?: number | null;
  /** 距离型：实际公里 */
  distanceKm?: number | null;
  /** 心率 */
  hrBpm?: number | null;
  rpe?: number | null;
  done: boolean;
  completedAt: ISODateTime | null;
}

export type ExerciseStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface ExerciseProgress {
  exerciseId: string;
  name: string;
  kind: SessionKind;
  target: TargetSpec;
  cue?: string;
  notes?: string;
  sets: SetRecord[];
  status: ExerciseStatus;
  /** 临时增加/减少的组数增量 */
  extraSets: number;
  /** 临时调整后的重量/次数/休息（覆盖目标） */
  override?: {
    weightKg?: number | null;
    reps?: string | null;
    restSec?: number | null;
  };
  note?: string;
}

/** 跟练过程中的打卡日志，用于防重复点击 */
export interface SessionLogEntry {
  id: string;
  at: ISODateTime;
  type:
    | 'set-complete'
    | 'set-undo'
    | 'exercise-done'
    | 'exercise-skip'
    | 'sets-add'
    | 'sets-remove'
    | 'pause'
    | 'resume'
    | 'pain'
    | 'note'
    | 'start'
    | 'finish';
  detail?: string;
  exerciseId?: string;
  setId?: string;
}

export interface PainRecord {
  id: string;
  at: ISODateTime;
  site: string;
  level: number;
  note?: string;
  exerciseId?: string;
}

export interface LiveSession {
  id: string;
  planId: string;
  planTitle: string;
  kind: SessionKind;
  startedAt: ISODateTime;
  endedAt: ISODateTime | null;
  /** 已累计的训练秒数（暂停前累计） */
  accumulatedSec: number;
  /** 最近一次恢复计时的时间；暂停时为 null */
  lastResumedAt: ISODateTime | null;
  status: 'active' | 'paused' | 'finished' | 'abandoned';
  currentIndex: number;
  exercises: ExerciseProgress[];
  /** 休息倒计时：绝对结束时间（锁屏/切后台依然准确） */
  restUntil: ISODateTime | null;
  restTotalSec: number;
  /** 记录休息结束后应回到哪个动作 */
  restAfterExerciseId?: string | null;
  logs: SessionLogEntry[];
  pain: PainRecord[];
  /** 训练中的临时备注 */
  note?: string;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* 训练记录与统计                                                       */
/* ------------------------------------------------------------------ */

export interface CardioRecord {
  kind: SessionKind;
  exerciseName: string;
  durationSec: number | null;
  distanceKm: number | null;
  paceText?: string | null;
  speedKph?: number | null;
  avgHr?: number | null;
  playMin?: number | null;
}

export interface WorkoutSummary {
  id: string;
  sessionId: string;
  planId: string;
  planTitle: string;
  kind: SessionKind;
  date: ISODate;
  startedAt: ISODateTime;
  endedAt: ISODateTime;
  totalDurationSec: number;
  completedExercises: string[];
  skippedExercises: string[];
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  /** 0~1 */
  completionRate: number;
  cardio: CardioRecord[];
  bodyWeightKg?: number | null;
  rpe?: number | null;
  fatigue?: number | null;
  painSites?: string[];
  feeling?: string;
  note?: string;
  createdAt: ISODateTime;
}

/** 身体数据 */
export interface BodyMetric {
  id: string;
  date: ISODate;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  sleepHours?: number | null;
  /** 1-5 */
  sleepQuality?: number | null;
  /** 1-5 酸痛程度 */
  soreness?: number | null;
  /** 恢复状态 1-5 */
  recovery?: number | null;
  waterMl?: number | null;
  proteinG?: number | null;
  restingHr?: number | null;
  note?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** 每日总结 / 日志（每天一条，id = date） */
export interface DailyLog {
  id: string;
  date: ISODate;
  weightKg?: number | null;
  trainingContent?: string;
  trainingVolumeKg?: number | null;
  rpe?: number | null;
  sleepHours?: number | null;
  diet?: string;
  supplements?: {
    proteinScoops?: number | null;
    proteinG?: number | null;
    creatineG?: number | null;
    others?: string;
  };
  pain?: string;
  feeling?: string;
  fatigue?: number | null;
  note?: string;
  summaryId?: string;
  source?: DataSource;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* 动作库 / 模板 / PR / 目标                                            */
/* ------------------------------------------------------------------ */

export interface ExerciseDef {
  id: string;
  name: string;
  kind: SessionKind;
  primaryMuscles: string[];
  equipment?: string;
  cue?: string;
  tags?: string[];
  custom?: boolean;
}

export interface PlanTemplate {
  id: string;
  name: string;
  kind: SessionKind;
  estimatedMinutes?: number | null;
  warmup: WarmupItem[];
  exercises: ExerciseItem[];
  note?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type PRMetric = 'weight' | 'reps' | 'volume' | 'time' | 'distance' | 'pace';

export interface PersonalRecord {
  id: string;
  exerciseName: string;
  metric: PRMetric;
  value: number;
  unit: string;
  date: ISODate;
  sessionId?: string;
  note?: string;
  createdAt: ISODateTime;
}

export interface Goal {
  id: string;
  title: string;
  kind: 'weight' | 'frequency' | 'strength' | 'cardio' | 'other';
  startValue?: number | null;
  targetValue?: number | null;
  unit?: string;
  deadline?: ISODate | null;
  note?: string;
  done: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* PDF 导入                                                            */
/* ------------------------------------------------------------------ */

export type PdfKind = 'plan' | 'daily-summary' | 'weekly-plan' | 'body-report' | 'unknown';

export const PDF_KIND_LABEL: Record<PdfKind, string> = {
  plan: '健身计划',
  'daily-summary': '今日训练总结',
  'weekly-plan': '周训练计划',
  'body-report': '身体数据报告',
  unknown: '未识别',
};

/** 一次 PDF 导入的原始记录（IndexedDB 保存 PDF 文字内容） */
export interface PdfImportRecord {
  id: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  importedAt: ISODateTime;
  kind: PdfKind;
  /** 每页文字 */
  pages: string[];
  /** 合并后的全文 */
  text: string;
  /** 是否需要 OCR（扫描版） */
  ocrRequired: boolean;
  /** 解析出的计划（确认保存后的 id） */
  planId?: string | null;
  dailyLogId?: string | null;
  /** 是否已确认保存 */
  saved: boolean;
}

/** 导入确认页面的可编辑草稿 */
export interface PlanDraft {
  kind: 'plan';
  importId: string;
  fileName: string;
  title: string;
  date: ISODate | null;
  sessionKind: SessionKind;
  estimatedMinutes: number | null;
  warmup: WarmupItem[];
  exercises: ExerciseItem[];
  cooldown: string;
  notes: string;
  /** 解析置信度 0~1 */
  confidence: number;
  warnings: string[];
}

export interface SummaryDraft {
  kind: 'daily-summary';
  importId: string;
  fileName: string;
  date: ISODate;
  weightKg: number | null;
  trainingContent: string;
  trainingVolumeKg: number | null;
  rpe: number | null;
  sleepHours: number | null;
  diet: string;
  supplements: DailyLog['supplements'];
  pain: string;
  feeling: string;
  fatigue: number | null;
  note: string;
  confidence: number;
  warnings: string[];
}

export type ImportDraft = PlanDraft | SummaryDraft;

/** 合并预览：新增 / 修改 / 保持不变 */
export interface MergeDiff<T> {
  creates: { label: string; value: string }[];
  updates: { label: string; from: string; to: string }[];
  unchanged: string[];
  /** 与已有记录的冲突提示 */
  conflicts: string[];
  targetId?: string | null;
  payload: T;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'system' | 'light' | 'dark';
export type WeightUnit = 'kg' | 'lb';

export interface AppSettings {
  id: 'app';
  theme: ThemeMode;
  unit: WeightUnit;
  defaultRestSec: number;
  bodyWeightGoalKg?: number | null;
  weeklyFrequencyGoal?: number | null;
  installPromptDismissed?: boolean;
  installPromptSeenAt?: ISODateTime | null;
  remindEnabled?: boolean;
  remindTime?: string;
  lastBackupAt?: ISODateTime | null;
  updatedAt: ISODateTime;
}

/** JSON 备份文件结构 */
export interface BackupFile {
  app: 'wo-de-xun-lian';
  version: 1;
  exportedAt: ISODateTime;
  data: {
    plans: TrainingPlan[];
    summaries: WorkoutSummary[];
    bodyMetrics: BodyMetric[];
    dailyLogs: DailyLog[];
    exercises: ExerciseDef[];
    templates: PlanTemplate[];
    prs: PersonalRecord[];
    goals: Goal[];
    settings: AppSettings | null;
    liveSession: LiveSession | null;
    pdfImports: PdfImportRecord[];
  };
}
