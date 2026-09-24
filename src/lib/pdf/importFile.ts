/**
 * PDF 文件导入入口（会加载 pdf.js，属重量级模块）
 * 单独成文件，方便在 UI 层按需 import()，避免拖慢首屏。
 */
import type { PdfImportRecord } from '../../types';
import { nowISO, uid } from '../format';
import { classifyPdf, looksLikePlanDocumentTitle } from './classify';
import { buildDraft } from './buildDraft';
import { saveDraftToSession, type AnyDraft } from './draft';
import { readPdfFile } from './readPdf';

export interface ImportOutcome {
  record: PdfImportRecord;
  draft: AnyDraft;
  ocrRequired: boolean;
}

export interface ImportOptions {
  /** 入口意图：计划入口可把旧的误分类记录重新按计划解析 */
  intent?: 'auto' | 'plan';
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
  const forcePlan =
    opts.intent === 'plan' && looksLikePlanDocumentTitle(extracted.text, extracted.fileName);
  const effectiveKind =
    forcePlan && classification.kind !== 'weekly-plan' ? ('plan' as const) : classification.kind;

  const record: PdfImportRecord = {
    id: uid('pdf'),
    fileName: extracted.fileName,
    fileSize: extracted.fileSize,
    pageCount: extracted.pageCount,
    importedAt: nowISO(),
    kind: effectiveKind,
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
export function isAlreadySaved(
  records: PdfImportRecord[],
  fileName: string,
  fileSize: number,
): boolean {
  return records.some(
    (r) => r.saved && r.fileName === fileName && Math.abs(r.fileSize - fileSize) < 1024,
  );
}

export { PdfReadError } from './readPdf';
export type { ExtractedPdf } from './readPdf';
