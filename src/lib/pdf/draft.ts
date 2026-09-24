/**
 * 导入草稿的交接（sessionStorage）与「合并预览」计算。
 * 说明：BodyDraft / WeeklyDraft / OcrDraft 是导入模块的内部类型，
 * 不修改冻结的 src/types/index.ts。
 */
import type {
  DailyLog,
  MergeDiff,
  PdfImportRecord,
  PlanDraft,
  SummaryDraft,
} from '../../types';
import { formatNumber } from '../format';
import type { BodyDraft } from './parseBodyReport';

export interface WeeklyDraft {
  kind: 'weekly-plan';
  importId: string;
  fileName: string;
  days: PlanDraft[];
  warnings: string[];
}

export interface OcrDraft {
  kind: 'ocr';
  importId: string;
  fileName: string;
  pageCount: number;
  warnings: string[];
}

export type AnyDraft = PlanDraft | SummaryDraft | BodyDraft | WeeklyDraft | OcrDraft;

export const DRAFT_KEY = 'wdxl:import-draft';

const SUPPORTED: AnyDraft['kind'][] = ['plan', 'daily-summary', 'body-report', 'weekly-plan', 'ocr'];

export function saveDraftToSession(draft: AnyDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn('[pdf] 草稿保存失败', err);
  }
}

function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return value == null || typeof value === 'number';
}

function isPlanDraftShape(value: unknown): value is PlanDraft {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<PlanDraft>;
  if (
    typeof plan.importId !== 'string' ||
    typeof plan.fileName !== 'string' ||
    typeof plan.title !== 'string' ||
    (plan.date != null && typeof plan.date !== 'string') ||
    typeof plan.sessionKind !== 'string' ||
    !Array.isArray(plan.warmup) ||
    !Array.isArray(plan.exercises) ||
    typeof plan.cooldown !== 'string' ||
    typeof plan.notes !== 'string' ||
    typeof plan.confidence !== 'number' ||
    !Array.isArray(plan.warnings)
  ) {
    return false;
  }
  return plan.exercises.every((exercise) => {
    if (!exercise || typeof exercise !== 'object') return false;
    const item = exercise as Partial<PlanDraft['exercises'][number]>;
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.kind !== 'string' ||
      typeof item.order !== 'number' ||
      !item.target ||
      typeof item.target !== 'object'
    ) {
      return false;
    }
    const target = item.target;
    return (
      isOptionalNullableNumber(target.sets) &&
      isOptionalNullableNumber(target.durationSec) &&
      isOptionalNullableNumber(target.weightKg) &&
      isOptionalNullableNumber(target.restSec) &&
      isOptionalNullableNumber(target.rpe) &&
      (target.durationText == null || typeof target.durationText === 'string') &&
      (target.durationPerSide == null || typeof target.durationPerSide === 'boolean') &&
      (target.restText == null || typeof target.restText === 'string') &&
      (target.reps == null || typeof target.reps === 'string')
    );
  });
}

function isSupportedDraftShape(value: unknown): value is AnyDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<AnyDraft> & { days?: unknown };
  if (draft.kind === 'plan') return isPlanDraftShape(draft);
  if (draft.kind === 'weekly-plan') {
    return typeof draft.importId === 'string' && Array.isArray(draft.days) && draft.days.every(isPlanDraftShape);
  }
  return SUPPORTED.includes(draft.kind as AnyDraft['kind']);
}

export function readDraftFromSession(): AnyDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSupportedDraftShape(parsed)) {
      console.warn('[pdf] 忽略字段缺失或类型不正确的导入草稿');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftFromSession(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------- 合并预览 */

interface FieldSpec {
  key: keyof DailyLog;
  label: string;
  fmt?: (v: unknown) => string;
}

const num = (v: unknown) => (typeof v === 'number' ? formatNumber(v) : String(v ?? ''));

const FIELDS: FieldSpec[] = [
  { key: 'weightKg', label: '体重', fmt: (v) => `${num(v)} kg` },
  { key: 'trainingContent', label: '训练内容' },
  { key: 'trainingVolumeKg', label: '训练量', fmt: (v) => `${num(v)} kg` },
  { key: 'rpe', label: 'RPE' },
  { key: 'sleepHours', label: '睡眠', fmt: (v) => `${num(v)} 小时` },
  { key: 'diet', label: '饮食' },
  { key: 'pain', label: '疼痛/不适' },
  { key: 'feeling', label: '今日感受' },
  { key: 'fatigue', label: '疲劳程度' },
  { key: 'note', label: '备注' },
];

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/** 把草稿转成要写入的 DayLog 字段（不覆盖已有记录里草稿为空的字段） */
export function draftToDailyLogPatch(draft: SummaryDraft): Partial<DailyLog> {
  const patch: Partial<DailyLog> = {
    date: draft.date,
    weightKg: draft.weightKg,
    trainingContent: draft.trainingContent || undefined,
    trainingVolumeKg: draft.trainingVolumeKg,
    rpe: draft.rpe,
    sleepHours: draft.sleepHours,
    diet: draft.diet || undefined,
    pain: draft.pain || undefined,
    feeling: draft.feeling || undefined,
    fatigue: draft.fatigue,
    note: draft.note || undefined,
    summaryId: draft.importId,
    source: 'pdf',
  };
  const s = draft.supplements;
  if (s && (s.proteinG != null || s.proteinScoops != null || s.creatineG != null || str(s.others))) {
    patch.supplements = {
      proteinG: s.proteinG ?? null,
      proteinScoops: s.proteinScoops ?? null,
      creatineG: s.creatineG ?? null,
      others: s.others,
    };
  }
  return patch;
}

export function diffDailyLog(
  existing: DailyLog | null,
  draft: SummaryDraft,
  ctx: { duplicateImport?: boolean; hasTrainingSummary?: boolean } = {},
): MergeDiff<Partial<DailyLog>> {
  const patch = draftToDailyLogPatch(draft);
  const creates: { label: string; value: string }[] = [];
  const updates: { label: string; from: string; to: string }[] = [];
  const unchanged: string[] = [];

  for (const f of FIELDS) {
    const next = patch[f.key];
    if (next == null || str(next) === '') continue;
    const prev = existing?.[f.key];
    const fmt = f.fmt ?? str;
    if (prev == null || str(prev) === '') {
      creates.push({ label: f.label, value: fmt(next) });
    } else if (str(prev) === str(next)) {
      unchanged.push(f.label);
    } else {
      updates.push({ label: f.label, from: fmt(prev), to: fmt(next) });
    }
  }

  // 补剂单独比较
  const sup = patch.supplements;
  const supLabels: ['proteinG' | 'proteinScoops' | 'creatineG', string, string][] = [
    ['proteinG', '蛋白粉摄入', 'g'],
    ['proteinScoops', '蛋白粉勺数', '勺'],
    ['creatineG', '肌酸', 'g'],
  ];
  if (sup) {
    for (const [key, label, unit] of supLabels) {
      const next = sup[key];
      if (next == null) continue;
      const prev = existing?.supplements?.[key];
      const value = `${formatNumber(next as number)} ${unit}`;
      if (prev == null) creates.push({ label, value });
      else if (prev === next) unchanged.push(label);
      else updates.push({ label, from: `${formatNumber(prev)} ${unit}`, to: value });
    }
  }

  const identical = existing != null && creates.length === 0 && updates.length === 0;
  const conflicts: string[] = [];
  if (ctx.duplicateImport) {
    conflicts.push('这份 PDF 之前已经导入过（文件名与大小一致），请确认不是重复操作。');
  }
  if (identical) {
    conflicts.push('与已有记录完全一致，无需重复保存。');
  } else {
    if (existing?.summaryId && existing.summaryId === draft.importId) {
      conflicts.push('这一天的总结已经由同一份 PDF 导入过，重复保存会产生冗余记录。');
    }
    if (ctx.hasTrainingSummary) {
      conflicts.push('当天已有一次 App 内训练记录，合并后会与训练报告共同存在（不会删除训练报告）。');
    }
  }

  return { creates, updates, unchanged, conflicts, targetId: existing?.id ?? draft.date, payload: patch };
}

export function describeDraft(draft: AnyDraft): string {
  switch (draft.kind) {
    case 'plan':
      return `健身计划 · ${draft.exercises.length} 个动作`;
    case 'weekly-plan':
      return `周训练计划 · ${draft.days.length} 天`;
    case 'daily-summary':
      return '今日训练总结';
    case 'body-report':
      return `身体数据报告 · ${draft.entries.length} 条记录`;
    case 'ocr':
      return '扫描版 PDF（需要 OCR）';
  }
}

/** 按入口意图选择可复用的历史导入；计划入口忽略以前误存成总结/报告的同一文件。 */
export function findSavedImportForIntent(
  records: PdfImportRecord[],
  fileName: string,
  fileSize: number,
  intent: 'auto' | 'plan' = 'auto',
): PdfImportRecord | null {
  const matches = records.filter(
    (r) => r.saved && r.fileName === fileName && Math.abs(r.fileSize - fileSize) < 1024,
  );
  if (intent === 'plan') {
    return matches.find((r) => r.kind === 'plan' || r.kind === 'weekly-plan') ?? null;
  }
  return matches[0] ?? null;
}

export function findDuplicateImport(
  records: PdfImportRecord[],
  fileName: string,
  fileSize: number,
): PdfImportRecord | null {
  return (
    records.find(
      (r) => r.saved && r.fileName === fileName && Math.abs(r.fileSize - fileSize) < 1024,
    ) ?? null
  );
}
