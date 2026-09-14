/**
 * PDF 导入总入口：读文件 -> 分类 -> 解析 -> 产出「导入确认」草稿
 * 全程在浏览器本地完成，不上传任何数据。
 */
import type { PdfImportRecord } from '../../types';
import { nowISO, toISODate, uid } from '../format';
import { classifyPdf } from './classify';
import { saveDraftToSession, type AnyDraft } from './draft';
import { parseBodyReportText } from './parseBodyReport';
import { parsePlanText, parseWeeklyPlanBody } from './parsePlan';
import { parseSummaryText } from './parseSummary';
import { readPdfFile } from './readPdf';

export interface ImportOutcome {
  record: PdfImportRecord;
  draft: AnyDraft;
  ocrRequired: boolean;
}

/** 把已保存的 PDF 记录（含每页文字）重新解析成草稿 */
export function buildDraft(record: PdfImportRecord): AnyDraft {
  const base = { fileName: record.fileName, importId: record.id, today: toISODate() };
  if (record.ocrRequired || record.kind === 'unknown') {
    const probe = classifyPdf(record.text, record.fileName);
    if (record.ocrRequired) {
      return {
        kind: 'ocr',
        importId: record.id,
        fileName: record.fileName,
        pageCount: record.pageCount,
        warnings: ['这是扫描版 PDF：没有文字层，无法直接识别。'],
      };
    }
    if (probe.kind === 'unknown') {
      const draft = parsePlanText(record.text, base);
      return {
        ...draft,
        warnings: ['无法确定 PDF 类型，已按「健身计划」解析，请在下面确认。', ...draft.warnings],
      };
    }
  }

  switch (record.kind) {
    case 'plan':
      return parsePlanText(record.text, base);
    case 'weekly-plan': {
      const { days, warnings } = parseWeeklyPlanBody(record.text, base);
      if (!days.length) {
        const single = parsePlanText(record.text, base);
        return {
          ...single,
          warnings: ['未能按天拆分周计划，已合并为一个计划。', ...warnings, ...single.warnings],
        };
      }
      return { kind: 'weekly-plan', importId: record.id, fileName: record.fileName, days, warnings };
    }
    case 'daily-summary':
      return parseSummaryText(record.text, base);
    case 'body-report':
      return parseBodyReportText(record.text, base);
    default: {
      const draft = parsePlanText(record.text, base);
      return {
        ...draft,
        warnings: ['未能确定类型，已按健身计划解析，请确认。', ...draft.warnings],
      };
    }
  }
}

export interface ImportOptions {
  /** 解析进度 0~1 */
  onProgress?: (ratio: number) => void;
  /** 保存原始记录（含每页文字）到 IndexedDB */
  save?: (record: PdfImportRecord) => Promise<void>;
}

export async function importPdfFile(file: File, opts: ImportOptions = {}): Promise<ImportOutcome> {
  const extracted = await readPdfFile(file, opts.onProgress);
  const classification = extracted.ocrRequired
    ? { kind: 'unknown' as const, confidence: 0 }
    : classifyPdf(extracted.text, extracted.fileName);

  const record: PdfImportRecord = {
    id: uid('pdf'),
    fileName: extracted.fileName,
    fileSize: extracted.fileSize,
    pageCount: extracted.pageCount,
    importedAt: nowISO(),
    kind: classification.kind,
    pages: extracted.pages,
    text: extracted.text,
    ocrRequired: extracted.ocrRequired,
    saved: false,
  };

  const draft = buildDraft(record);
  if (draft.kind === 'ocr') record.kind = 'unknown';
  record.planId = null;
  record.dailyLogId = null;

  if (opts.save) await opts.save(record);
  saveDraftToSession(draft);
  return { record, draft, ocrRequired: extracted.ocrRequired };
}

/** 最近一次导入的 PDF 是否已成功保存过（防止重复导入） */
export function isAlreadySaved(records: PdfImportRecord[], fileName: string, fileSize: number): boolean {
  return records.some((r) => r.saved && r.fileName === fileName && Math.abs(r.fileSize - fileSize) < 1024);
}

export { PdfReadError } from './readPdf';
export type { ExtractedPdf } from './readPdf';
export type { AnyDraft, OcrDraft, WeeklyDraft } from './draft';
export type { BodyDraft, BodyEntry } from './parseBodyReport';
export { bodyEntriesToMetrics } from './parseBodyReport';
export { diffDailyLog, draftToDailyLogPatch, saveDraftToSession, readDraftFromSession, clearDraftFromSession, describeDraft, findDuplicateImport } from './draft';
export { parsePlanText, parseWeeklyPlanBody, parseTargetFromText } from './parsePlan';
export { parseSummaryText } from './parseSummary';
export { parseBodyReportText } from './parseBodyReport';
export { classifyPdf } from './classify';
