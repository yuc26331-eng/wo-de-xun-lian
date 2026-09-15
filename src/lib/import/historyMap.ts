/**
 * 历史报告 → 网站数据结构 的映射与合并（纯函数，便于测试）
 *
 * 原则：
 * - 报告里没有的字段一律留空，不填 0、不猜数值
 * - 训练建议 / 未来计划不写成"已完成训练"
 * - 同一天已有记录时只补空字段，不覆盖用户已有数据，冲突单独列出
 */
import {
  SESSION_KIND_LABEL,
  type AttachmentMeta,
  type CardioRecord,
  type DailyDocumentImport,
  type DailyLog,
  type ISODate,
  type ISODateTime,
  type ReportScore,
  type SessionKind,
  type SupplementEntry,
  type TrainingSessionDetail,
  type WorkoutSummary,
} from '../../types';
import type { HistoryBundleDay, HistorySession } from './historyBundle';

const KINDS: SessionKind[] = [
  'strength',
  'run',
  'ride',
  'football',
  'stretch',
  'recovery',
  'other',
];

const KIND_CN: Record<string, SessionKind> = {
  力量: 'strength',
  力量训练: 'strength',
  strength: 'strength',
  跑步: 'run',
  run: 'run',
  骑行: 'ride',
  ride: 'ride',
  足球: 'football',
  football: 'football',
  拉伸: 'stretch',
  stretch: 'stretch',
  恢复: 'recovery',
  recovery: 'recovery',
  其他: 'other',
  other: 'other',
};

/** 报告里的评分项 → 中文标签（只映射报告真实给出的项） */
const SCORE_LABEL: Record<string, string> = {
  training: '训练质量',
  completion: '训练完成度',
  intensity: '训练强度',
  load: '负荷控制',
  volume: '训练量',
  control: '训练控制',
  activeRecovery: '主动恢复',
  diet: '饮食',
  dietQuality: '饮食质量',
  dietRecovery: '饮食恢复',
  protein: '蛋白补充',
  recovery: '恢复',
  sleepRecovery: '睡眠恢复',
  sleep: '睡眠',
  activity: '活动量',
  caffeine: '咖啡因',
  supplement: '补剂',
  body: '身体感受',
  overall: '综合',
};

const MAX_SCORE = 10;

export function toSessionKind(raw: string | undefined | null): SessionKind {
  const key = (raw ?? '').trim();
  if (!key) return 'other';
  if (KIND_CN[key]) return KIND_CN[key];
  const lower = key.toLowerCase();
  if (KIND_CN[lower]) return KIND_CN[lower];
  const hit = KINDS.find((k) => lower.includes(k));
  return hit ?? 'other';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 只保留有值的键，避免写出 null / '' 覆盖用户数据 */
function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function sessionDetail(s: HistorySession): TrainingSessionDetail {
  return compact({
    name: trim(s.name) || '训练',
    kind: toSessionKind(s.kind),
    durationMin: isNum(s.durationMin) ? s.durationMin : null,
    distanceKm: isNum(s.distanceKm) ? s.distanceKm : null,
    kcal: isNum(s.kcal) ? s.kcal : null,
    avgHr: isNum(s.avgHr) ? s.avgHr : null,
    maxHr: isNum(s.maxHr) ? s.maxHr : null,
    rpe: isNum(s.rpe) ? s.rpe : null,
    paceText: trim(s.pace) || undefined,
    note: trim(s.note) || undefined,
  }) as TrainingSessionDetail;
}

/** 补剂：报告里的"杯 / 份"按原单位保留，不换算成克 */
function supplementList(day: HistoryBundleDay): SupplementEntry[] {
  const sup = day.supplements ?? {};
  const list: SupplementEntry[] = [];
  const push = (name: string, amount: number | null | undefined, unit: string) => {
    if (!isNum(amount) || amount <= 0) return;
    list.push({ id: `hist-${day.date}-sup-${list.length + 1}`, name, amount, unit });
  };
  push('蛋白粉', sup.proteinCups, '杯');
  push('肌酸', sup.creatineCups, '份');
  push('咖啡因/咖啡', sup.caffeineCups, '杯');
  push('蛋白粉', sup.proteinScoops, '勺');
  push('肌酸', sup.creatineG, 'g');
  push('蛋白粉', sup.proteinG, 'g');
  push('咖啡因', sup.caffeineMg, 'mg');
  return list;
}

function scoreList(
  scores: Record<string, number> | undefined,
  labels: Record<string, string> | undefined,
): ReportScore[] {
  if (!scores) return [];
  return Object.entries(scores)
    .filter(([, v]) => isNum(v))
    .map(([k, v]) => ({ label: labels?.[k] ?? SCORE_LABEL[k] ?? k, value: v, max: MAX_SCORE }));
}

function summaryNote(day: HistoryBundleDay, session: HistorySession): string {
  const bits = [
    '由历史 PDF 报告导入',
    trim(session.note),
    isText(day.training?.exercises) ? `报告动作记录：${day.training.exercises.trim()}` : '',
    '报告未提供逐组重量/次数明细，故组数、次数、容量留空（0 表示未记录）',
  ].filter(Boolean);
  return bits.join('；');
}

function cardioOf(session: TrainingSessionDetail): CardioRecord | null {
  const kind = session.kind ?? 'other';
  if (!['run', 'ride', 'football', 'stretch', 'recovery'].includes(kind)) return null;
  return {
    kind,
    exerciseName: session.name,
    durationSec: isNum(session.durationMin) ? Math.round(session.durationMin * 60) : null,
    distanceKm: isNum(session.distanceKm) ? session.distanceKm : null,
    paceText: session.paceText ?? null,
    speedKph: null,
    avgHr: isNum(session.avgHr) ? session.avgHr : null,
    playMin: null,
  };
}

export interface MappedAttachment {
  id: string;
  meta: AttachmentMeta;
  /** PDF 原文（base64） */
  base64: string;
}

export interface MappedHistoryDay {
  date: ISODate;
  log: DailyLog;
  summaries: WorkoutSummary[];
  attachment: MappedAttachment | null;
  /** 实际写入的字段说明（用于导入结果展示） */
  imported: string[];
  /** 报告本身存在的问题（例如缺日期、缺时长），不影响其他字段 */
  warnings: string[];
}

/** 把导入包里的一天映射成网站的 DailyLog / WorkoutSummary / 附件 */
export function mapHistoryDay(day: HistoryBundleDay, now: ISODateTime): MappedHistoryDay {
  const date = day.date.trim();
  const warnings: string[] = [];
  const imported: string[] = [];

  const sessions = (day.training?.sessions ?? [])
    .map(sessionDetail)
    .filter((s) => isText(s.name));
  const durations = sessions.map((s) => s.durationMin).filter(isNum);
  const allDurationsKnown = sessions.length > 0 && durations.length === sessions.length;
  const missingDuration = sessions.length > durations.length;
  if (missingDuration) warnings.push('报告未记录部分训练的时长，已只保留有记录的时长');

  const primary = sessions
    .slice()
    .sort((a, b) => (isNum(b.durationMin) ? b.durationMin : -1) - (isNum(a.durationMin) ? a.durationMin : -1))[0];
  const dayKind: SessionKind | undefined = primary?.kind ?? (day.training?.items ? 'other' : undefined);

  const runSession = sessions.find((s) => s.kind === 'run' && isNum(s.distanceKm));
  const dayRpe =
    (isNum(day.training?.rpe) ? (day.training?.rpe as number) : null) ??
    (sessions.length === 1 && isNum(sessions[0].rpe) ? (sessions[0].rpe as number) : null);
  const painSites = (day.training?.painSites ?? []).map((p) => p.trim()).filter(Boolean);

  const training = compact({
    kind: dayKind ?? null,
    items: trim(day.training?.items) || undefined,
    exercises: trim(day.training?.exercises) || undefined,
    durationMin: allDurationsKnown
      ? Math.round(durations.reduce((a, b) => a + b, 0) * 10) / 10
      : null,
    runDistanceKm: runSession?.distanceKm ?? null,
    runPaceText: runSession?.paceText ?? undefined,
    rpe: dayRpe,
    completionPct: isNum(day.training?.completionPct) ? day.training?.completionPct : null,
    volumeKg: null,
    feeling: undefined,
    matchPerformance: trim(day.training?.matchPerformance) || undefined,
    painSites,
    sessionCount: isNum(day.training?.sessionCount)
      ? (day.training?.sessionCount as number)
      : sessions.length || undefined,
    sessionDurationsMin: durations.length ? durations : undefined,
    restDay: day.training?.restDay ?? undefined,
    sessions: sessions.length ? sessions : undefined,
  }) as DailyLog['training'];

  const watch = compact({
    activeEnergyKcal: isNum(day.watch?.activeEnergyKcal)
      ? day.watch?.activeEnergyKcal
      : null,
    totalEnergyKcal: isNum(day.watch?.totalEnergyKcal) ? day.watch?.totalEnergyKcal : null,
    steps: isNum(day.watch?.steps) ? day.watch?.steps : null,
    exerciseMinutes: isNum(day.watch?.exerciseMinutes) ? day.watch?.exerciseMinutes : null,
    standHours: isNum(day.watch?.standHours) ? day.watch?.standHours : null,
    distanceKm: isNum(day.watch?.distanceKm) ? day.watch?.distanceKm : null,
    avgHr: isNum(day.watch?.avgHr) ? day.watch?.avgHr : null,
    maxHr: isNum(day.watch?.maxHr) ? day.watch?.maxHr : null,
    restingHr: isNum(day.watch?.restingHr)
      ? day.watch?.restingHr
      : isNum(day.resting_hr)
        ? day.resting_hr
        : null,
    hrRecovery: isNum(day.watch?.hrRecovery) ? day.watch?.hrRecovery : null,
    hrvMs: isNum(day.watch?.hrvMs) ? day.watch?.hrvMs : isNum(day.hrv_ms) ? day.hrv_ms : null,
    bloodOxygenPct: isNum(day.watch?.bloodOxygenPct) ? day.watch?.bloodOxygenPct : null,
    note: trim(day.watch?.note) || undefined,
  }) as DailyLog['watch'];

  const sleep = compact({
    bedTime: trim(day.sleep?.bedTime) || undefined,
    sleepTime: trim(day.sleep?.sleepTime) || undefined,
    wakeTime: trim(day.sleep?.wakeTime) || undefined,
    totalHours: isNum(day.sleep?.totalHours) ? day.sleep?.totalHours : null,
    deepHours: isNum(day.sleep?.deepHours) ? day.sleep?.deepHours : null,
    coreHours: isNum(day.sleep?.coreHours) ? day.sleep?.coreHours : null,
    remHours: isNum(day.sleep?.remHours) ? day.sleep?.remHours : null,
    awakeHours: isNum(day.sleep?.awakeHours) ? day.sleep?.awakeHours : null,
    napMinutes: isNum(day.sleep?.napMinutes) ? day.sleep?.napMinutes : null,
    quality: isNum(day.sleep?.quality) ? day.sleep?.quality : null,
    note: trim(day.sleep?.note) || undefined,
  }) as DailyLog['sleep'];

  const body = compact({
    weightKg: isNum(day.weight_kg) ? day.weight_kg : null,
    bodyFatPct: isNum(day.body_fat_pct) ? day.body_fat_pct : null,
    fatigue10: isNum(day.fatigue10) ? day.fatigue10 : null,
    fatigue: null,
    injuryPain: painSites.join('、'),
    overall: undefined,
  }) as DailyLog['body'];

  const meals = compact({
    breakfast: trim(day.meals?.breakfast) || undefined,
    lunch: trim(day.meals?.lunch) || undefined,
    dinner: trim(day.meals?.dinner) || undefined,
    snack: trim(day.meals?.snack) || undefined,
    waterMl: isNum(day.meals?.waterMl) ? day.meals?.waterMl : null,
    note: trim(day.meals?.note) || undefined,
  }) as DailyLog['meals'];

  const supplements = compact({
    proteinG: isNum(day.supplements?.proteinG) ? day.supplements?.proteinG : null,
    proteinScoops: isNum(day.supplements?.proteinScoops) ? day.supplements?.proteinScoops : null,
    creatineG: isNum(day.supplements?.creatineG) ? day.supplements?.creatineG : null,
    caffeineMg: isNum(day.supplements?.caffeineMg) ? day.supplements?.caffeineMg : null,
    others: [trim(day.supplements?.caffeineNote), trim(day.supplements?.others)]
      .filter(Boolean)
      .join('；'),
    note: trim(day.supplements?.note) || undefined,
  }) as DailyLog['supplements'];

  const supplementsList = supplementList(day);
  const scores = scoreList(day.scores, day.scoreLabels);
  const attachmentId = `hist-${date}`;
  const reportNote = trim(day.note);

  const freeBits: string[] = [`【历史报告导入】${day.title || date}（${day.file}）`];
  if (reportNote) freeBits.push(`【报告备注】${reportNote}`);
  if (scores.length) {
    freeBits.push(
      `【报告评分】${scores.map((s) => `${s.label} ${s.value}/${s.max}`).join('、')}`,
    );
  }
  freeBits.push('【原文】完整报告原文已随本日记录保存，可在本日详情里查看或下载原始 PDF。');

  const report: DailyDocumentImport = {
    title: day.title || day.file,
    fileName: day.file,
    importedAt: now,
    source: 'history-pdf',
    reportText: day.reportText ?? '',
    note: reportNote || undefined,
    scores: scores.length ? scores : undefined,
    pdfSize: isNum(day.pdfSize) ? day.pdfSize : undefined,
    attachmentId,
  };

  const log: DailyLog = {
    id: date,
    date,
    training,
    watch,
    sleep,
    body,
    meals,
    supplements,
    supplementsList,
    freeNote: freeBits.join('\n'),
    attachmentIds: [attachmentId],
    markedComplete: true,
    status: 'final',
    completedSteps: ['training', 'watch', 'sleep', 'intensity', 'supplements', 'extra', 'review'],
    lastStep: 'review',
    finalizedAt: now,
    source: 'pdf',
    reportImports: [report],
    createdAt: now,
    updatedAt: now,
  };

  const summaries: WorkoutSummary[] = sessions.map((s, i) => {
    const cardio = cardioOf(s);
    const durationMin = isNum(s.durationMin) ? s.durationMin : null;
    return {
      id: `hist-${date}-${i + 1}`,
      sessionId: `hist-${date}-${i + 1}`,
      planId: `hist-plan-${date}`,
      planTitle: s.name,
      kind: s.kind ?? 'other',
      date,
      startedAt: `${date}T00:00:00.000Z`,
      endedAt: `${date}T00:00:00.000Z`,
      totalDurationSec: durationMin != null ? Math.round(durationMin * 60) : 0,
      completedExercises: [],
      skippedExercises: [],
      totalSets: 0,
      totalReps: 0,
      totalVolumeKg: 0,
      completionRate: 1,
      cardio: cardio ? [cardio] : [],
      exerciseSets: [],
      bodyWeightKg: null,
      rpe: isNum(s.rpe) ? s.rpe : null,
      fatigue: isNum(day.fatigue10) ? day.fatigue10 : null,
      painSites,
      feeling: undefined,
      note: summaryNote(day, s),
      createdAt: now,
    };
  });

  /* --------- 导入说明（用于结果页展示"到底写进去了什么"） --------- */
  if (log.training?.items || log.training?.exercises) imported.push('训练内容');
  if (sessions.length) imported.push(`${sessions.length} 场训练记录`);
  if (isNum(log.training?.durationMin)) imported.push('训练时长');
  if (Object.keys(watch ?? {}).length) imported.push('Apple Watch 数据');
  if (Object.keys(sleep ?? {}).length) imported.push('睡眠记录');
  if (isNum(body?.fatigue10)) imported.push('疲劳（0~10）');
  if (isNum(body?.weightKg)) imported.push('体重');
  if (isNum(body?.bodyFatPct)) imported.push('体脂率');
  if (Object.keys(meals ?? {}).length) imported.push('饮食');
  if (supplementsList.length) imported.push('补剂');
  if (reportNote) imported.push('报告文字总结');
  if (day.reportText) imported.push('报告原文');
  if (day.pdfBase64) imported.push('原始 PDF 附件');

  const attachment: MappedAttachment | null = day.pdfBase64
    ? {
        id: attachmentId,
        base64: day.pdfBase64,
        meta: {
          id: attachmentId,
          date,
          kind: 'other',
          name: day.file || `${day.title || date}.pdf`,
          type: 'application/pdf',
          size: isNum(day.pdfSize) ? day.pdfSize : Math.round((day.pdfBase64.length * 3) / 4),
          createdAt: now,
        },
      }
    : null;

  return { date, log, summaries, attachment, imported, warnings };
}

/* ------------------------------------------------------------------ */
/* 合并：同一天已有记录时只补空，不覆盖                                  */
/* ------------------------------------------------------------------ */

export interface FieldConflict {
  date: ISODate;
  label: string;
  existing: string;
  incoming: string;
}

export interface MergeResult {
  log: DailyLog;
  /** 与已有数据冲突（保留原值）的字段 */
  conflicts: FieldConflict[];
  /** 补进空字段的项 */
  fills: string[];
}

const show = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.length ? `${v.length} 项` : '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
};

interface SectionSpec<T> {
  label: string;
  keys: { key: keyof T; label: string }[];
}

const SECTION_SPECS: Record<string, SectionSpec<Record<string, unknown>>> = {
  training: {
    label: '训练记录',
    keys: [
      { key: 'kind', label: '训练类型' },
      { key: 'items', label: '训练项目' },
      { key: 'exercises', label: '动作记录' },
      { key: 'durationMin', label: '训练时长（分钟）' },
      { key: 'runDistanceKm', label: '跑步距离（km）' },
      { key: 'runPaceText', label: '跑步配速' },
      { key: 'rpe', label: 'RPE' },
      { key: 'completionPct', label: '完成度（%）' },
      { key: 'volumeKg', label: '训练容量（kg）' },
      { key: 'feeling', label: '训练感受' },
      { key: 'matchPerformance', label: '比赛/足球表现' },
      { key: 'sessionCount', label: '训练次数' },
    ],
  },
  watch: {
    label: 'Apple Watch',
    keys: [
      { key: 'activeEnergyKcal', label: '活动能量' },
      { key: 'totalEnergyKcal', label: '总消耗' },
      { key: 'steps', label: '步数' },
      { key: 'exerciseMinutes', label: '运动分钟' },
      { key: 'standHours', label: '站立时间' },
      { key: 'distanceKm', label: '移动距离（km）' },
      { key: 'avgHr', label: '平均心率' },
      { key: 'maxHr', label: '最高心率' },
      { key: 'restingHr', label: '静息心率' },
      { key: 'hrRecovery', label: '心率恢复' },
      { key: 'hrvMs', label: 'HRV' },
      { key: 'bloodOxygenPct', label: '血氧' },
      { key: 'note', label: '备注' },
    ],
  },
  sleep: {
    label: '睡眠',
    keys: [
      { key: 'bedTime', label: '上床时间' },
      { key: 'sleepTime', label: '入睡时间' },
      { key: 'wakeTime', label: '起床时间' },
      { key: 'totalHours', label: '总睡眠（小时）' },
      { key: 'deepHours', label: '深度睡眠' },
      { key: 'coreHours', label: '核心睡眠' },
      { key: 'remHours', label: 'REM' },
      { key: 'awakeHours', label: '夜间清醒' },
      { key: 'napMinutes', label: '午睡（分钟）' },
      { key: 'quality', label: '睡眠质量' },
      { key: 'note', label: '备注' },
    ],
  },
  body: {
    label: '身体与恢复',
    keys: [
      { key: 'weightKg', label: '体重（kg）' },
      { key: 'bodyFatPct', label: '体脂率（%）' },
      { key: 'fatigue10', label: '疲劳（0~10）' },
      { key: 'fatigue', label: '疲劳（1~5）' },
      { key: 'soreness', label: '酸痛' },
      { key: 'mood', label: '精神状态' },
      { key: 'appetite', label: '食欲' },
      { key: 'stress', label: '压力' },
      { key: 'injuryPain', label: '伤病/疼痛' },
      { key: 'recovery', label: '恢复情况' },
      { key: 'overall', label: '整体感受' },
    ],
  },
  meals: {
    label: '饮食',
    keys: [
      { key: 'breakfast', label: '早餐' },
      { key: 'lunch', label: '午餐' },
      { key: 'dinner', label: '晚餐' },
      { key: 'snack', label: '加餐' },
      { key: 'waterMl', label: '饮水量' },
      { key: 'note', label: '备注' },
    ],
  },
  supplements: {
    label: '补剂',
    keys: [
      { key: 'proteinG', label: '蛋白粉（g）' },
      { key: 'proteinScoops', label: '蛋白粉（勺）' },
      { key: 'creatineG', label: '肌酸（g）' },
      { key: 'caffeineMg', label: '咖啡因（mg）' },
      { key: 'others', label: '其他补剂' },
      { key: 'note', label: '备注' },
    ],
  },
};

/** 合并两个列表（按 name+unit 去重），返回合并结果 */
function mergeSupplementList(
  existing: SupplementEntry[] | undefined,
  incoming: SupplementEntry[] | undefined,
): SupplementEntry[] {
  const out: SupplementEntry[] = [...(existing ?? [])];
  for (const item of incoming ?? []) {
    const hit = out.find((x) => x.name === item.name && (x.unit ?? '') === (item.unit ?? ''));
    if (hit) {
      if ((hit.amount ?? 0) < (item.amount ?? 0)) hit.amount = item.amount;
      continue;
    }
    out.push(item);
  }
  return out;
}

export function mergeDailyLog(
  incoming: DailyLog,
  existing: DailyLog | null,
  now: ISODateTime,
): MergeResult {
  if (!existing) return { log: { ...incoming, updatedAt: now }, conflicts: [], fills: [] };

  const conflicts: FieldConflict[] = [];
  const fills: string[] = [];
  const out: DailyLog = { ...existing };

  for (const [section, spec] of Object.entries(SECTION_SPECS)) {
    const incomingSection = (incoming as unknown as Record<string, unknown>)[section] as
      | Record<string, unknown>
      | undefined;
    if (!incomingSection) continue;
    const existingSection = { ...((out as unknown as Record<string, unknown>)[section] as Record<string, unknown> | undefined) };
    for (const { key, label } of spec.keys) {
      const incomingValue = incomingSection[key as string];
      if (!show(incomingValue)) continue;
      const existingValue = existingSection[key as string];
      if (!show(existingValue)) {
        existingSection[key as string] = incomingValue;
        fills.push(`${spec.label}·${label}`);
        continue;
      }
      if (show(existingValue) !== show(incomingValue)) {
        conflicts.push({
          date: incoming.date,
          label: `${spec.label}·${label}`,
          existing: show(existingValue),
          incoming: show(incomingValue),
        });
      }
    }
    (out as unknown as Record<string, unknown>)[section] = existingSection;
  }

  /* 列表类字段：并集，不删除已有内容 */
  const existingSessions = existing.training?.sessions ?? [];
  const incomingSessions = incoming.training?.sessions ?? [];
  if (incomingSessions.length) {
    const merged = [...existingSessions];
    for (const s of incomingSessions) {
      if (!merged.some((x) => x.name === s.name && x.durationMin === s.durationMin)) merged.push(s);
    }
    out.training = { ...out.training, sessions: merged };
  }

  const painSites = Array.from(
    new Set([...(existing.training?.painSites ?? []), ...(incoming.training?.painSites ?? [])]),
  );
  if (painSites.length) out.training = { ...out.training, painSites };

  out.supplementsList = mergeSupplementList(existing.supplementsList, incoming.supplementsList);
  out.attachmentIds = Array.from(
    new Set([...(existing.attachmentIds ?? []), ...(incoming.attachmentIds ?? [])]),
  );

  /* 报告留档：按文件名去重后追加，不覆盖旧报告 */
  const reports: DailyDocumentImport[] = [...(existing.reportImports ?? [])];
  for (const rep of incoming.reportImports ?? []) {
    if (!reports.some((r) => r.fileName === rep.fileName && r.title === rep.title)) reports.push(rep);
  }
  if (reports.length) out.reportImports = reports;

  /* 自由备注：已有内容时追加，不覆盖 */
  const existingNote = trim(existing.freeNote);
  const incomingNote = trim(incoming.freeNote);
  if (incomingNote) {
    if (!existingNote) {
      out.freeNote = incomingNote;
      fills.push('自由记录');
    } else if (!existingNote.includes(incomingNote)) {
      out.freeNote = `${existingNote}\n\n${incomingNote}`;
      fills.push('自由记录（追加）');
    }
  }

  out.id = existing.id || incoming.date;
  out.date = existing.date || incoming.date;
  out.createdAt = existing.createdAt ?? now;
  out.updatedAt = now;
  out.markedComplete = existing.markedComplete || incoming.markedComplete;
  out.status = existing.status === 'draft' ? 'final' : (existing.status ?? 'final');
  out.finalizedAt = existing.finalizedAt ?? incoming.finalizedAt ?? now;
  out.source = existing.source ?? incoming.source;
  out.completedSteps = Array.from(
    new Set([...(existing.completedSteps ?? []), ...(incoming.completedSteps ?? [])]),
  );

  return { log: out, conflicts, fills };
}

/** 供界面展示：报告覆盖的日期范围（单日记录） */
export function kindLabel(kind: SessionKind | null | undefined): string {
  return kind ? (SESSION_KIND_LABEL[kind] ?? kind) : '未指定';
}
