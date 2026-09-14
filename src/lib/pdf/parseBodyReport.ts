/** 身体数据报告解析：体重 / 体脂 / 睡眠 / 静息心率 等（可能多天） */
import type { BodyMetric, ISODate } from '../../types';
import { cleanLines, firstNumber, matchLabel, normalizeText, parseDateLoose, tableCells } from './text';

export interface BodyEntry {
  date: ISODate;
  weightKg: number | null;
  bodyFatPct: number | null;
  sleepHours: number | null;
  restingHr: number | null;
}

export interface BodyDraft {
  kind: 'body-report';
  importId: string;
  fileName: string;
  entries: BodyEntry[];
  confidence: number;
  warnings: string[];
}

function todayISO(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function valueByLabels(line: string, labels: string[], unitRe: RegExp): number | null {
  const hit = matchLabel(line, labels);
  const source = hit?.value ?? line;
  const withUnit = source.match(unitRe);
  if (withUnit) return Number(withUnit[1]);
  if (hit) return firstNumber(source);
  return null;
}

export function parseBodyReportText(
  text: string,
  opts: { fileName?: string; importId: string },
): BodyDraft {
  const lines = cleanLines(text);
  const entries: BodyEntry[] = [];
  const warnings: string[] = [];

  // 1) 表格 / 逐行：每行一个日期 + 若干数值
  for (const line of lines) {
    const cells = tableCells(line);
    const normalized = normalizeText(line);
    const date = parseDateLoose(normalized);
    const weight = valueByLabels(normalized, ['体重', '重量'], /(\d{2,3}(?:\.\d+)?)\s*(?:kg|公斤|千克)/i);
    const bodyFat = valueByLabels(normalized, ['体脂率', '体脂', '脂肪率'], /(\d{1,2}(?:\.\d+)?)\s*%/);
    const sleep = valueByLabels(normalized, ['睡眠', '睡眠时长'], /(\d{1,2}(?:\.\d+)?)\s*(?:小时|h\b|hr)/i);
    const hr = valueByLabels(normalized, ['静息心率', '心率'], /(\d{2,3})\s*(?:bpm|次\/分)?/i);

    if (cells && cells.length >= 3 && !date) {
      // 无日期的表格行：跳过表头
      continue;
    }
    if (!date) {
      if (weight == null && bodyFat == null && sleep == null && hr == null) continue;
      // 没有日期但有关键字段 -> 归到今天
      const existingToday = entries.find((e) => e.date === todayISO());
      const target =
        existingToday ??
        (() => {
          const e: BodyEntry = {
            date: todayISO(),
            weightKg: null,
            bodyFatPct: null,
            sleepHours: null,
            restingHr: null,
          };
          entries.push(e);
          return e;
        })();
      target.weightKg = target.weightKg ?? weight;
      target.bodyFatPct = target.bodyFatPct ?? bodyFat;
      target.sleepHours = target.sleepHours ?? sleep;
      target.restingHr = target.restingHr ?? hr;
      continue;
    }
    if (weight == null && bodyFat == null && sleep == null && hr == null) continue;

    const hit = entries.find((e) => e.date === date);
    const entry: BodyEntry = hit ?? {
      date,
      weightKg: null,
      bodyFatPct: null,
      sleepHours: null,
      restingHr: null,
    };
    entry.weightKg = entry.weightKg ?? weight;
    entry.bodyFatPct = entry.bodyFatPct ?? bodyFat;
    entry.sleepHours = entry.sleepHours ?? sleep;
    entry.restingHr = entry.restingHr ?? hr;
    if (!hit) entries.push(entry);
  }

  if (!entries.length) {
    const weight = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:kg|公斤)/i);
    if (weight) {
      entries.push({
        date: todayISO(),
        weightKg: Number(weight[1]),
        bodyFatPct: null,
        sleepHours: null,
        restingHr: null,
      });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!entries.length) warnings.push('没有识别到身体数据，请确认 PDF 是否包含日期与体重/体脂。');
  if (entries.length > 60) warnings.push('识别到超过 60 天的数据，已只保留最近的 60 条。');

  return {
    kind: 'body-report',
    importId: opts.importId,
    fileName: opts.fileName ?? '身体数据报告.pdf',
    entries: entries.slice(-60),
    confidence: Math.min(1, entries.length ? 0.6 + Math.min(entries.length, 8) * 0.05 : 0.1),
    warnings,
  };
}

/** 草稿 -> 可写入 IndexedDB 的身体数据记录 */
export function bodyEntriesToMetrics(entries: BodyEntry[]): BodyMetric[] {
  const now = new Date().toISOString();
  return entries.map((e) => ({
    id: e.date,
    date: e.date,
    weightKg: e.weightKg,
    bodyFatPct: e.bodyFatPct,
    sleepHours: e.sleepHours,
    restingHr: e.restingHr,
    createdAt: now,
    updatedAt: now,
  }));
}
