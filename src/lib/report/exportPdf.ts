/** 浏览器端导出：按需加载中文字体与生成库，下载 PDF 文件 */
import type { BodyMetric, DailyLog, LiveSession, TrainingPlan, WorkoutSummary } from '../../types';
import type { ReportFonts, SummaryReportInput } from './buildReportPdf';

/** pdf-lib 只在真正导出时才加载，避免拖慢首屏 */
async function loadReportLib() {
  return import('./buildReportPdf');
}

let fontCache: ReportFonts | null = null;

async function loadFonts(): Promise<ReportFonts> {
  if (fontCache) return fontCache;
  const base = import.meta.env.BASE_URL || '/';
  const [regular, bold] = await Promise.all([
    fetch(`${base}fonts/NotoSansSC-Regular.ttf`).then((r) => {
      if (!r.ok) throw new Error('中文字体加载失败');
      return r.arrayBuffer();
    }),
    fetch(`${base}fonts/NotoSansSC-Bold.ttf`).then((r) => {
      if (!r.ok) throw new Error('中文字体加载失败');
      return r.arrayBuffer();
    }),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

function download(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportSummaryPdf(input: SummaryReportInput): Promise<void> {
  const { buildSummaryPdf } = await loadReportLib();
  const fonts = await loadFonts();
  const bytes = await buildSummaryPdf(input, fonts);
  download(bytes, `训练报告-${input.summary.date}-${input.summary.planTitle}.pdf`);
}

export async function exportPlanPdf(plan: TrainingPlan): Promise<void> {
  const { buildPlanPdf } = await loadReportLib();
  const fonts = await loadFonts();
  const bytes = await buildPlanPdf(plan, fonts);
  download(bytes, `训练计划-${plan.date ?? '未定日期'}-${plan.title}.pdf`);
}

export type { LiveSession, WorkoutSummary, TrainingPlan, BodyMetric, DailyLog };

/* ------------------------------------------------------------------ */
/* 「给 ChatGPT 分析」报告：PDF / Markdown / 纯文本 / JSON 四种格式      */
/* ------------------------------------------------------------------ */

import type {
  AttachmentMeta,
  BodyMetric as BodyMetricType,
  DailyLog as DailyLogType,
  ISODate,
  WorkoutSummary as SummaryType,
} from '../../types';
import {
  buildRangeData,
  buildRangeSummary,
  exportFileName,
  toJson,
  toMarkdown,
  toPlainText,
  type DayBundle,
  type ExportContext,
  type ExportInclude,
  type RangeSummary,
} from './chatgptExport';

export type ReportFormat = 'pdf' | 'markdown' | 'text' | 'json';

export interface ChatGptExportRequest {
  start: ISODate;
  end: ISODate;
  include: ExportInclude;
  context: ExportContext;
}

export interface ChatGptExportResult {
  days: DayBundle[];
  summary: RangeSummary;
}

/** 生成预览数据（不下载），供导出预览界面与导出动作共用 */
export function prepareChatGptExport(req: ChatGptExportRequest): ChatGptExportResult {
  const days = buildRangeData(req.start, req.end, req.context);
  const summary = buildRangeSummary(days);
  return { days, summary };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 导出并下载；返回导出的文件名 */
export async function exportChatGptReport(
  req: ChatGptExportRequest,
  format: ReportFormat,
): Promise<string> {
  const { days, summary } = prepareChatGptExport(req);

  if (format === 'markdown') {
    const name = exportFileName(req.start, req.end, 'md');
    downloadBlob(new Blob([toMarkdown(days, summary, req.include)], { type: 'text/markdown' }), name);
    return name;
  }
  if (format === 'text') {
    const name = exportFileName(req.start, req.end, 'txt');
    downloadBlob(
      new Blob([toPlainText(days, summary, req.include)], { type: 'text/plain;charset=utf-8' }),
      name,
    );
    return name;
  }
  if (format === 'json') {
    const name = exportFileName(req.start, req.end, 'json');
    downloadBlob(
      new Blob([toJson(days, summary, req.include)], { type: 'application/json' }),
      name,
    );
    return name;
  }

  // PDF：按需加载 pdf-lib 与中文字体
  const [{ buildChatGptRangePdf, pdfFileName }, fonts] = await Promise.all([
    import('./buildChatGptPdf'),
    loadFonts(),
  ]);
  const bytes = await buildChatGptRangePdf({ days, include: req.include, summary }, fonts);
  const name = pdfFileName(req.start, req.end);
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), name);
  return name;
}

export type { ExportContext, ExportInclude, DayBundle, RangeSummary };
export type { AttachmentMeta, BodyMetricType, DailyLogType, SummaryType };
