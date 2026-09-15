/** 把已保存的 PDF 记录（含每页文字）重新解析成导入草稿（纯逻辑，不依赖 pdf.js） */
import type { PdfImportRecord } from '../../types';
import { toISODate } from '../format';
import { classifyPdf } from './classify';
import { parseBodyReportText } from './parseBodyReport';
import { parsePlanText, parseWeeklyPlanBody } from './parsePlan';
import { parseSummaryText } from './parseSummary';
import type { AnyDraft } from './draft';

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
