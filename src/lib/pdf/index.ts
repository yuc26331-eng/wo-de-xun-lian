/**
 * PDF 模块的「轻量入口」：只导出纯解析逻辑（不引入 pdf.js）。
 * 需要真正读文件时用 `import('../lib/pdf/importFile')` 按需加载。
 */
export { buildDraft } from './buildDraft';
export type { AnyDraft, OcrDraft, WeeklyDraft } from './draft';
export type { BodyDraft, BodyEntry } from './parseBodyReport';
export { bodyEntriesToMetrics } from './parseBodyReport';
export { diffDailyLog, draftToDailyLogPatch, saveDraftToSession, readDraftFromSession, clearDraftFromSession, describeDraft, findDuplicateImport } from './draft';
export { parsePlanText, parseWeeklyPlanBody, parseTargetFromText } from './parsePlan';
export { parseSummaryText } from './parseSummary';
export { parseBodyReportText } from './parseBodyReport';
export { classifyPdf } from './classify';
