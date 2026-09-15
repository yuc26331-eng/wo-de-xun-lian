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

/** 训练记录中的单个动作实际完成情况（用于展示同一动作的进步） */
export interface ExerciseSetRecord {
  name: string;
  kind: SessionKind;
  sets: {
    index: number;
    weightKg: number | null;
    reps: number | null;
    durationSec?: number | null;
    distanceKm?: number | null;
    rpe?: number | null;
    done: boolean;
  }[];
  /** 该动作的完成组数 / 计划组数 */
  doneSets: number;
  plannedSets: number;
  status: ExerciseStatus;
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
  /** 每个动作的实际组数据（v1.1 起保存，旧记录可能没有） */
  exerciseSets?: ExerciseSetRecord[];
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

/* ------------------------------------------------------------------ */
/* 今日总结（每天一条，id = date）                                       */
/* ------------------------------------------------------------------ */

/** Apple Watch 与运动数据（全部可选，未记录就留空） */
export interface WatchData {
  activeEnergyKcal?: number | null;
  totalEnergyKcal?: number | null;
  steps?: number | null;
  exerciseMinutes?: number | null;
  standHours?: number | null;
  /** 手表记录的移动距离（km） */
  distanceKm?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  restingHr?: number | null;
  /** 心率恢复（1 分钟下降值） */
  hrRecovery?: number | null;
  /** HRV（毫秒） */
  hrvMs?: number | null;
  bloodOxygenPct?: number | null;
  note?: string;
}

export interface SleepData {
  /** 上床时间 HH:mm */
  bedTime?: string;
  /** 入睡时间 HH:mm */
  sleepTime?: string;
  /** 起床时间 HH:mm */
  wakeTime?: string;
  totalHours?: number | null;
  deepHours?: number | null;
  coreHours?: number | null;
  remHours?: number | null;
  awakeHours?: number | null;
  napMinutes?: number | null;
  /** 主观睡眠质量 1-5 */
  quality?: number | null;
  note?: string;
}

export interface BodyRecovery {
  weightKg?: number | null;
  bodyFatPct?: number | null;
  /** 疲劳程度（0~10，用于报告里给出的十分制评分，与 1~5 的 fatigue 并存） */
  fatigue10?: number | null;
  fatigue?: number | null;
  soreness?: number | null;
  mood?: number | null;
  appetite?: number | null;
  stress?: number | null;
  injuryPain?: string;
  recovery?: number | null;
  overall?: string;
}

export interface MealLog {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  snack?: string;
  /** 饮水量 ml */
  waterMl?: number | null;
  /** 当日饮食自由记录（v1 的 diet 字段会迁移到这里） */
  note?: string;
}

export interface SupplementLog {
  proteinScoops?: number | null;
  proteinG?: number | null;
  creatineG?: number | null;
  /** 咖啡因 mg */
  caffeineMg?: number | null;
  others?: string;
  /** 补剂备注（报告原文里关于补剂的原话） */
  note?: string;
}

export interface TrainingSection {
  kind?: SessionKind | null;
  items?: string;
  exercises?: string;
  durationMin?: number | null;
  runDistanceKm?: number | null;
  runPaceText?: string;
  rpe?: number | null;
  completionPct?: number | null;
  /** 训练容量 kg（可从训练记录自动带出，也可手改） */
  volumeKg?: number | null;
  feeling?: string;
  /** 比赛或足球训练表现 */
  matchPerformance?: string;
  painSites?: string[];
  /** 今天的训练次数（例如早晚各一次 = 2） */
  sessionCount?: number | null;
  /** 每次训练的时长（分钟） */
  sessionDurationsMin?: number[];
  /** 休息日：今天未训练 */
  restDay?: boolean;
  /** 当天每场训练的明细（历史报告导入时保留场次级数据） */
  sessions?: TrainingSessionDetail[];
}

/** 一天当中某一场训练的明细（场次级数据，来自训练记录或历史报告） */
export interface TrainingSessionDetail {
  name: string;
  kind?: SessionKind;
  durationMin?: number | null;
  distanceKm?: number | null;
  /** 动态消耗（千卡） */
  kcal?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  rpe?: number | null;
  /** 配速描述，例如 '5分54秒/公里' */
  paceText?: string;
  note?: string;
}

/** 报告里给出的评分项（例如 训练质量 8.1/10） */
export interface ReportScore {
  label: string;
  value: number;
  max: number;
}

/**
 * 历史文档导入留档（PDF 报告原文）。
 * 只用于「查看与追溯」，不参与任何自动计算，避免把报告结论当成实测数据。
 */
export interface DailyDocumentImport {
  /** 报告标题 */
  title: string;
  /** 原始文件名 */
  fileName: string;
  importedAt: ISODateTime;
  /** 数据来源：历史 PDF 报告 */
  source: 'history-pdf';
  /** PDF 中提取出的全文（文字层） */
  reportText: string;
  /** 报告中的总结、建议原文 */
  note?: string;
  /** 报告中的评分项 */
  scores?: ReportScore[];
  /** 原始 PDF 大小（字节） */
  pdfSize?: number;
  /** 原始 PDF 在附件表中的 id */
  attachmentId?: string;
}

export type AttachmentKind = 'watch' | 'sleep' | 'other';

/** 附件元数据（截图随每日总结保存） */
export interface AttachmentMeta {
  id: string;
  date: ISODate;
  kind: AttachmentKind;
  name: string;
  type: string;
  size: number;
  createdAt: ISODateTime;
  /** OCR 原始文字（识别过的截图才有） */
  ocrText?: string;
  /** OCR 识别出的字段（保留下来便于重新展示与纠错） */
  ocrFields?: Record<string, number | string | null>;
  ocrStatus?: 'pending' | 'done' | 'failed';
  ocrAt?: ISODateTime;
}

/** 自定义补剂记录 */
export interface SupplementEntry {
  id: string;
  name: string;
  amount?: number | null;
  unit?: string;
}

/** IndexedDB 中真实存储的附件（含二进制内容） */
export interface StoredAttachment extends AttachmentMeta {
  blob: Blob;
}

export interface DailyLog {
  id: string;
  date: ISODate;
  /** —— 结构化分区（v2 新增） —— */
  training?: TrainingSection;
  watch?: WatchData;
  sleep?: SleepData;
  body?: BodyRecovery;
  meals?: MealLog;
  freeNote?: string;
  attachmentIds?: string[];
  markedComplete?: boolean;
  /** 引导式总结的进行状态：draft = 草稿（未归档），final = 已保存归档 */
  status?: 'draft' | 'final';
  /** 已完成的步骤 key */
  completedSteps?: string[];
  /** 上次停留的步骤 key（用于继续填写） */
  lastStep?: string;
  /** 自定义补剂（名称 / 用量 / 单位） */
  supplementsList?: SupplementEntry[];
  /** 今天没吃补剂 */
  noSupplements?: boolean;
  /** 归档时间（点击「保存今日总结」后写入） */
  finalizedAt?: ISODateTime;
  /** 历史报告（PDF）导入留档：原文、评分与附件引用（同一天可以有多份） */
  reportImports?: DailyDocumentImport[];
  /** —— v1 兼容字段（旧数据继续可用） —— */
  weightKg?: number | null;
  trainingContent?: string;
  trainingVolumeKg?: number | null;
  rpe?: number | null;
  sleepHours?: number | null;
  diet?: string;
  supplements?: SupplementLog;
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
/* ChatGPT 分析报告（与每日原始记录分开保存，通过日期范围关联）            */
/* ------------------------------------------------------------------ */

export interface ChatGptReport {
  id: string;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  summaryText: string;
  bodyText: string;
  evaluation?: string;
  suggestions?: string;
  risks?: string;
  rawText?: string;
  pdfBlob?: Blob;
  fileName?: string;
  pdfSize?: number;
  note?: string;
  tags: string[];
  parseWarnings?: string[];
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
  /** 目标体脂率（%） */
  bodyFatGoalPct?: number | null;
  weeklyFrequencyGoal?: number | null;
  /** 一次性数据清理标记（避免重复清理） */
  cleanupVersion?: number | null;
  cleanupAt?: ISODateTime | null;
  /** 示例数据是否已经播种过（清理后不再自动写回） */
  samplesInitialized?: boolean;
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
    chatGptReports?: ChatGptReport[];
    attachments?: AttachmentMeta[];
  };
}

/** 清理前的自动备份留档（可随时导出） */
export interface BackupSnapshot {
  id: string;
  createdAt: ISODateTime;
  reason: string;
  /** 备份 JSON 文本 */
  payload: string;
  /** 概要，便于展示 */
  summary: Record<string, number>;
}
