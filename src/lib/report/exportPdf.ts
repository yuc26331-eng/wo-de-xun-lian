/** 浏览器端导出：按需加载中文字体与生成库，下载 PDF 文件 */
import type { BodyMetric, DailyLog, LiveSession, TrainingPlan, WorkoutSummary } from '../../types';
import {
  buildPlanPdf,
  buildSummaryPdf,
  type ReportFonts,
  type SummaryReportInput,
} from './buildReportPdf';

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
  const fonts = await loadFonts();
  const bytes = await buildSummaryPdf(input, fonts);
  download(bytes, `训练报告-${input.summary.date}-${input.summary.planTitle}.pdf`);
}

export async function exportPlanPdf(plan: TrainingPlan): Promise<void> {
  const fonts = await loadFonts();
  const bytes = await buildPlanPdf(plan, fonts);
  download(bytes, `训练计划-${plan.date ?? '未定日期'}-${plan.title}.pdf`);
}

export type { LiveSession, WorkoutSummary, TrainingPlan, BodyMetric, DailyLog };
