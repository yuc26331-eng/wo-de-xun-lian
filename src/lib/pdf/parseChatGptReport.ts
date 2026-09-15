/**
 * 解析 ChatGPT 生成的（单日或多日）分析报告 PDF 文本。
 * 日期范围可能是 1 / 3 / 5 / 7 / 10 天或任意区间，绝不能默认只对应一天。
 * 解析不确定时给出 warnings，由用户在导入确认页手动修改。
 */
import type { ISODate } from '../../types';
import { addDays, toISODate } from '../format';

export interface ChatGptReportDraft {
  kind: 'chatgpt-report';
  importId: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  title: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  summaryText: string;
  bodyText: string;
  evaluation: string;
  suggestions: string;
  risks: string;
  rawText: string;
  confidence: number;
  warnings: string[];
}

const CN_NUM: Record<string, string> = {
  一: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
};

const pad = (n: number) => `${n}`.padStart(2, '0');
const iso = (y: number, m: number, d: number): ISODate =>
  `${y}-${pad(m)}-${pad(d)}` as ISODate;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

interface FoundDates {
  dates: ISODate[];
  partial: boolean;
}

/** 从文本里找出所有能识别的日期（支持 2026-09-15 / 2026年9月15日 / 9月15日） */
function findDates(text: string, fallbackYear: number): FoundDates {
  const out: ISODate[] = [];
  let partial = false;

  const full = [
    /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?/g,
  ];
  for (const re of full) {
    for (const m of text.matchAll(re)) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (validDate(y, mo, d)) out.push(iso(y, mo, d));
    }
  }

  // 只有月日（例如「9月10日 - 9月16日」）：年份用标题里的年份或当前年
  const partialRe = /(?<![\d年])(\d{1,2})月(\d{1,2})日?/g;
  for (const m of text.matchAll(partialRe)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (!validDate(fallbackYear, mo, d)) continue;
    out.push(iso(fallbackYear, mo, d));
    partial = true;
  }

  return { dates: [...new Set(out)].sort(), partial };
}

/** 识别「最近 N 天」这类相对范围 */
function relativeRange(text: string): number | null {
  const m = text.match(/(?:最近|近|过去|近这)\s*([0-9一二两三四五六七八九十]{1,2})\s*(?:天|日)/);
  if (!m) {
    if (/一周|这周|本周|过去一周/.test(text)) return 7;
    return null;
  }
  const raw = m[1];
  const n = Number(raw) || Number(CN_NUM[raw] ?? 0);
  return n > 0 && n <= 90 ? n : null;
}

const SECTION_PATTERNS: { key: 'evaluation' | 'suggestions' | 'risks'; re: RegExp }[] = [
  { key: 'evaluation', re: /^(?:\d+[.、]\s*)?(?:#+\s*)?(总体?评价|整体评价|评价|总评|结论)/ },
  { key: 'suggestions', re: /^(?:\d+[.、]\s*)?(?:#+\s*)?(建议|训练建议|调整建议|下一步)/ },
  { key: 'risks', re: /^(?:\d+[.、]\s*)?(?:#+\s*)?(风险|风险提醒|注意|警示|需要警惕)/ },
];

export interface ParseReportMeta {
  fileName: string;
  fileSize: number;
  pageCount: number;
  today?: ISODate;
}

export function parseChatGptReportText(
  rawText: string,
  meta: ParseReportMeta,
): ChatGptReportDraft {
  const text = (rawText ?? '').replace(/\r/g, '').trim();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const warnings: string[] = [];
  const today = meta.today ?? toISODate();
  const fallbackYear = Number(today.slice(0, 4));

  // 标题：优先带「报告」字样的行，否则第一行
  let title =
    lines.find((l) => /报告|分析|总结/.test(l) && l.length <= 40) ?? lines[0] ?? 'ChatGPT 分析报告';
  title = title.replace(/^[#\s]*/, '').replace(/^报告标题[:：]\s*/, '').trim();
  if (title.length > 60) title = `${title.slice(0, 58)}…`;

  // 日期范围
  let start: ISODate | null = null;
  let end: ISODate | null = null;
  const { dates, partial } = findDates(text, fallbackYear);
  if (dates.length >= 2) {
    start = dates[0];
    end = dates[dates.length - 1];
  } else if (dates.length === 1) {
    start = dates[0];
    end = dates[0];
    warnings.push('只识别到一个日期，已按单日报告处理，请确认日期范围');
  } else {
    const n = relativeRange(text);
    if (n) {
      // 用本地日期推算，避免 toISOString 造成的时区偏移（例如 UTC+8 少一天）
      start = addDays(today, -(n - 1));
      end = today;
      warnings.push(`报告写的是「最近 ${n} 天」，已按 ${start} ~ ${end} 处理，请确认`);
    } else {
      warnings.push('没有识别到日期范围，请手动填写开始与结束日期');
    }
    if (partial) warnings.push('日期缺少年份，已按当前年份处理');
  }

  // 分区：评价 / 建议 / 风险
  const buckets: Record<'evaluation' | 'suggestions' | 'risks', string[]> = {
    evaluation: [],
    suggestions: [],
    risks: [],
  };
  const body: string[] = [];
  let current: keyof typeof buckets | null = null;
  for (const line of lines) {
    const hit = SECTION_PATTERNS.find((p) => p.re.test(line));
    if (hit) {
      current = hit.key;
      const rest = line.replace(hit.re, '').replace(/^[:：\s]+/, '');
      if (rest) buckets[hit.key].push(rest);
      continue;
    }
    if (current) buckets[current].push(line);
    else body.push(line);
  }

  const bodyText = body.join('\n').trim() || text;
  const summarySource =
    buckets.evaluation.join('\n').trim() ||
    body.slice(1, 6).join('\n').trim() ||
    text.slice(0, 400);
  const summaryText = summarySource.length > 600 ? `${summarySource.slice(0, 598)}…` : summarySource;

  // 置信度
  let confidence = 0.4;
  if (dates.length >= 2) confidence += 0.35;
  else if (dates.length === 1) confidence += 0.15;
  if (buckets.evaluation.length) confidence += 0.1;
  if (buckets.suggestions.length) confidence += 0.1;
  if (warnings.length === 0) confidence += 0.05;

  return {
    kind: 'chatgpt-report',
    importId: `report_${Date.now().toString(36)}`,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    pageCount: meta.pageCount,
    title,
    startDate: start,
    endDate: end,
    summaryText,
    bodyText,
    evaluation: buckets.evaluation.join('\n').trim(),
    suggestions: buckets.suggestions.join('\n').trim(),
    risks: buckets.risks.join('\n').trim(),
    rawText: text,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    warnings,
  };
}

export const DRAFT_KEY = 'wdxl:chatgpt-report-draft';

export function saveReportDraft(draft: ChatGptReportDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function readReportDraft(): ChatGptReportDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatGptReportDraft;
    return parsed?.kind === 'chatgpt-report' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearReportDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/* 待确认的原 PDF（内存态；页面刷新后需要重新选择文件） */
const pendingPdfs = new Map<string, Blob>();

export function stashPendingPdf(importId: string, blob: Blob): void {
  pendingPdfs.set(importId, blob);
}

export function takePendingPdf(importId: string): Blob | null {
  return pendingPdfs.get(importId) ?? null;
}
