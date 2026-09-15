/**
 * 中文 PDF 报告生成（纯计算，不依赖 DOM）
 * - 使用 pdf-lib + @pdf-lib/fontkit，嵌入 Noto Sans SC 子集字体，保证中文不乱码
 * - 统一走「测量 → 分页 → 绘制」流程，长文本自动折行、跨页续排，内容不会被截断
 */
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type {
  BodyMetric,
  DailyLog,
  LiveSession,
  SessionKind,
  TrainingPlan,
  WorkoutSummary,
} from '../../types';
import { SESSION_KIND_LABEL } from '../../types';
import {
  formatDateCN,
  formatDurationCN,
  formatMinSec,
  formatNumber,
  formatPace,
  formatVolume,
  targetSummary,
} from '../format';

export interface ReportFonts {
  regular: ArrayBuffer | Uint8Array;
  bold: ArrayBuffer | Uint8Array;
}

export interface SummaryReportInput {
  summary: WorkoutSummary;
  plan?: TrainingPlan | null;
  session?: LiveSession | null;
  metrics?: BodyMetric[];
  dailyLog?: DailyLog | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 44;
const CONTENT_W = A4[0] - MARGIN * 2;

const C = {
  text: rgb(0.11, 0.11, 0.12),
  muted: rgb(0.45, 0.45, 0.48),
  line: rgb(0.9, 0.9, 0.92),
  card: rgb(0.965, 0.965, 0.975),
  accent: rgb(0, 0.478, 1),
  accentSoft: rgb(0.93, 0.96, 1),
  white: rgb(1, 1, 1),
  green: rgb(0.2, 0.78, 0.35),
};

const KIND_TEXT: Record<SessionKind, string> = SESSION_KIND_LABEL;

/**
 * 剔除字体不支持的字符（emoji、非 BMP 字符、装饰符号），
 * 避免 PDF 里出现空白格或方块。中文常用字（GB2312 全集）、拉丁字母、
 * 数字与常见中文标点都完整保留。
 */
export function sanitizeForPdf(input: string): string {
  // 字体里没有的字形先映射到等价字符，避免出现方块
  const map: Record<string, string> = {
    '✗': '×',
    '✘': '×',
    '✔': '✓',
    '✅': '✓',
    '❌': '×',
    '～': '~',
    '—': '—',
  };
  let out = '';
  for (const ch of String(input ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0xffff) continue;
    if (code >= 0x1f000) continue;
    if (code >= 0x2600 && code <= 0x27bf) continue;
    if (code === 0xfe0f || code === 0x200d) continue;
    out += map[ch] ?? ch;
  }
  return out;
}

/**
 * 重要：必须使用 subset: false。
 * pdf-lib / fontkit 的运行时子集化在 CJK 字体上会破坏字形映射（实测缺字），
 * 因此本项目在构建期用 fontTools 生成 GB2312 全量子集字体，运行时整体嵌入。
 * 单个报告文件约 1.2~1.5MB，中文 100% 正确显示。
 */
const EMBED_SUBSET = false;

export class Report {
  doc!: PDFDocument;
  regular!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  pageIndex = 0;
  title = '训练报告';

  async init(fonts: ReportFonts, title: string) {
    this.doc = await PDFDocument.create();
    this.doc.registerFontkit(fontkit);
    this.regular = await this.doc.embedFont(fonts.regular, { subset: EMBED_SUBSET });
    this.bold = await this.doc.embedFont(fonts.bold, { subset: EMBED_SUBSET });
    this.doc.setTitle(title);
    this.doc.setProducer('我的训练 App');
    this.doc.setCreator('我的训练 App');
    this.title = title;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.pageIndex += 1;
    this.y = A4[1] - MARGIN;
  }

  footer() {
    const text = `第 ${this.pageIndex} 页 · 由「我的训练」在本地生成`;
    const size = 8.5;
    const w = this.regular.widthOfTextAtSize(text, size);
    this.page.drawText(text, {
      x: A4[0] - MARGIN - w,
      y: MARGIN / 2,
      size,
      font: this.regular,
      color: C.muted,
    });
  }

  finishFooters() {
    for (const p of this.doc.getPages()) {
      const i = this.doc.getPages().indexOf(p) + 1;
      const text = `第 ${i} 页 · 由「我的训练」在本地生成`;
      const size = 8.5;
      const w = this.regular.widthOfTextAtSize(text, size);
      p.drawText(text, {
        x: A4[0] - MARGIN - w,
        y: MARGIN / 2,
        size,
        font: this.regular,
        color: C.muted,
      });
      p.drawLine({
        start: { x: MARGIN, y: MARGIN / 2 + 14 },
        end: { x: A4[0] - MARGIN, y: MARGIN / 2 + 14 },
        thickness: 0.6,
        color: C.line,
      });
    }
  }

  /** 保证剩余空间足够，否则换页 */
  ensure(height: number) {
    if (this.y - height < MARGIN + 16) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    const paragraphs = sanitizeForPdf(text).split('\n');
    for (const para of paragraphs) {
      if (!para) {
        lines.push('');
        continue;
      }
      let line = '';
      let i = 0;
      while (i < para.length) {
        const ch = para[i];
        // 拉丁字母/数字成组断行，避免把单词切碎
        let chunk = ch;
        if (/[A-Za-z0-9.':%/+-]/.test(ch)) {
          let j = i;
          while (j < para.length && /[A-Za-z0-9.':%/+-]/.test(para[j])) j += 1;
          chunk = para.slice(i, j);
        }
        const test = line + chunk;
        if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
          lines.push(line);
          line = chunk.trimStart();
        } else {
          line = test;
        }
        i += chunk.length;
      }
      lines.push(line);
    }
    return lines;
  }

  text(
    content: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      gapAfter?: number;
      lineGap?: number;
      align?: 'left' | 'right';
    } = {},
  ) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.regular;
    const color = opts.color ?? C.text;
    const width = opts.width ?? CONTENT_W;
    const x = opts.x ?? MARGIN;
    const lineH = size * 1.55;
    const lines = this.wrap(content, font, size, width);
    for (const line of lines) {
      this.ensure(lineH);
      const w = font.widthOfTextAtSize(line, size);
      const px = opts.align === 'right' ? x + width - w : x;
      this.page.drawText(line, { x: px, y: this.y - size, size, font, color });
      this.y -= lineH;
    }
    this.y -= opts.gapAfter ?? 0;
  }

  /** 章节标题：蓝色小方块 + 加粗标题 */
  section(title: string) {
    this.ensure(34);
    this.y -= 10;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 11,
      width: 3.5,
      height: 14,
      color: C.accent,
    });
    this.page.drawText(title, {
      x: MARGIN + 10,
      y: this.y - 10,
      size: 13,
      font: this.bold,
      color: C.text,
    });
    this.y -= 24;
  }

  /** 键值统计卡片网格 */
  grid(items: { label: string; value: string }[], cols = 3) {
    const gap = 8;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    const h = 48;
    for (let i = 0; i < items.length; i += cols) {
      this.ensure(h + 8);
      const row = items.slice(i, i + cols);
      row.forEach((it, idx) => {
        const x = MARGIN + idx * (w + gap);
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, color: C.card });
        this.page.drawText(it.label, {
          x: x + 10,
          y: this.y - 16,
          size: 8.6,
          font: this.regular,
          color: C.muted,
        });
        const value = this.fit(it.value, this.bold, 13, w - 20);
        this.page.drawText(value, {
          x: x + 10,
          y: this.y - 36,
          size: 13,
          font: this.bold,
          color: C.text,
        });
      });
      this.y -= h + gap;
    }
    this.y -= 4;
  }

  /** 单行内容太长时缩小字号，避免溢出卡片 */
  fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
    let s = size;
    let out = String(text ?? '');
    while (font.widthOfTextAtSize(out, s) > maxWidth && s > 6) s -= 0.5;
    while (font.widthOfTextAtSize(out, s) > maxWidth && out.length > 1) {
      out = `${out.slice(0, -2)}…`;
    }
    return out;
  }

  /** 表格 */
  table(headers: string[], widths: number[], rows: string[][]) {
    const rowH = 22;
    const drawHeader = () => {
      this.ensure(rowH + 6);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - rowH,
        width: CONTENT_W,
        height: rowH,
        color: C.card,
      });
      let x = MARGIN + 8;
      headers.forEach((h, i) => {
        this.page.drawText(h, {
          x,
          y: this.y - 15,
          size: 9,
          font: this.bold,
          color: C.muted,
        });
        x += widths[i];
      });
      this.y -= rowH;
    };
    drawHeader();
    rows.forEach((row, ri) => {
      // 每行按内容折行的高度计算，长文本不截断
      const cellLines = row.map((cell, i) =>
        this.wrap(cell, this.regular, 10, widths[i] - 12),
      );
      const h = Math.max(rowH, Math.max(...cellLines.map((l) => l.length)) * 15 + 8);
      if (this.y - h < MARGIN + 16) {
        this.newPage();
        drawHeader();
      }
      if (ri % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - h,
          width: CONTENT_W,
          height: h,
          color: C.card,
          opacity: 0.55,
        });
      }
      let x = MARGIN + 8;
      cellLines.forEach((lines, i) => {
        lines.forEach((line, li) => {
          this.page.drawText(line, {
            x,
            y: this.y - 15 - li * 15,
            size: 10,
            font: this.regular,
            color: C.text,
          });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: A4[0] - MARGIN, y: this.y },
        thickness: 0.5,
        color: C.line,
      });
    });
    this.y -= 8;
  }

  header(title: string, sub: string) {
    // 顶部品牌条
    this.page.drawRectangle({
      x: 0,
      y: A4[1] - 6,
      width: A4[0],
      height: 6,
      color: C.accent,
    });
    this.y = A4[1] - MARGIN + 6;
    this.page.drawText('我的训练', {
      x: MARGIN,
      y: this.y - 10,
      size: 9,
      font: this.bold,
      color: C.accent,
    });
    this.y -= 26;
    const lines = this.wrap(title, this.bold, 20, CONTENT_W);
    for (const line of lines) {
      this.page.drawText(line, {
        x: MARGIN,
        y: this.y - 20,
        size: 20,
        font: this.bold,
        color: C.text,
      });
      this.y -= 26;
    }
    this.page.drawText(sub, {
      x: MARGIN,
      y: this.y - 10,
      size: 10,
      font: this.regular,
      color: C.muted,
    });
    this.y -= 26;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.8,
      color: C.line,
    });
    this.y -= 12;
  }
}

function safeFileText(s: string | null | undefined, fallback = '—'): string {
  const v = (s ?? '').toString().trim();
  return v || fallback;
}

/** 训练总结 / 报告 PDF */
export async function buildSummaryPdf(
  input: SummaryReportInput,
  fonts: ReportFonts,
): Promise<Uint8Array> {
  const { summary, plan, session, metrics, dailyLog } = input;
  const r = new Report();
  await r.init(fonts, `训练报告 · ${summary.planTitle}`);

  const kindText = KIND_TEXT[summary.kind] ?? '训练';
  r.header(summary.planTitle || '训练报告', `${formatDateCN(summary.date)} · ${kindText}`);

  const doneCount = summary.completedExercises.length;
  const skipCount = summary.skippedExercises.length;
  r.grid(
    [
      { label: '总训练时长', value: formatDurationCN(summary.totalDurationSec) },
      { label: '总训练容量', value: formatVolume(summary.totalVolumeKg) },
      { label: '完成率', value: `${Math.round((summary.completionRate || 0) * 100)}%` },
      { label: '完成动作', value: `${doneCount} 个` },
      { label: '跳过动作', value: `${skipCount} 个` },
      { label: '总组数 / 总次数', value: `${summary.totalSets} / ${summary.totalReps}` },
    ],
    3,
  );

  r.grid(
    [
      { label: '当日体重', value: summary.bodyWeightKg ? `${formatNumber(summary.bodyWeightKg)} kg` : '—' },
      { label: '训练 RPE', value: summary.rpe != null ? `${summary.rpe}` : '—' },
      { label: '疲劳程度', value: summary.fatigue != null ? `${summary.fatigue} / 10` : '—' },
    ],
    3,
  );

  // 动作明细
  const progressByName = new Map(
    (session?.exercises ?? []).map((e) => [e.name, e] as const),
  );
  const allExercises =
    plan?.exercises?.length
      ? plan.exercises
      : [...(session?.exercises ?? [])].map((e, i) => ({
          id: e.exerciseId,
          name: e.name,
          kind: e.kind,
          target: e.target,
          order: i,
          cue: e.cue,
          notes: e.notes,
        }));

  if (allExercises.length) {
    r.section('动作明细');
    const rows = allExercises.map((ex) => {
      const prog = progressByName.get(ex.name);
      const doneSets = prog?.sets.filter((s) => s.done) ?? [];
      const status =
        summary.skippedExercises.includes(ex.name)
          ? '跳过'
          : summary.completedExercises.includes(ex.name)
            ? '完成'
            : '未完成';
      const actual = doneSets.length
        ? doneSets
            .map((s) => {
              const bits: string[] = [];
              if (s.weightKg != null) bits.push(`${formatNumber(s.weightKg)}kg`);
              if (s.reps != null) bits.push(`${s.reps}次`);
              if (s.durationSec) bits.push(formatMinSec(s.durationSec));
              if (s.distanceKm) bits.push(`${formatNumber(s.distanceKm, 2)}km`);
              return bits.join('×');
            })
            .filter(Boolean)
            .join(' / ')
        : '—';
      const plannedSets = ex.target.sets ?? (doneSets.length || 1);
      return [ex.name, status, `${doneSets.length}/${plannedSets}`, actual];
    });
    r.table(['动作', '状态', '组数', '实际完成'], [150, 46, 54, CONTENT_W - 250], rows);
  }

  // 热身 / 拉伸
  if (plan?.warmup?.length) {
    r.section('热身安排');
    r.text(
      plan.warmup
        .map((w) => `· ${w.name}${w.detail ? `：${w.detail}` : ''}`)
        .join('\n'),
      { size: 10.5 },
    );
  }
  if (plan?.cooldown) {
    r.section('拉伸与恢复');
    r.text(plan.cooldown, { size: 10.5 });
  }

  // 有氧 / 足球
  if (summary.cardio.length) {
    r.section('跑步 · 骑行 · 足球记录');
    const rows = summary.cardio.map((c) => [
      c.exerciseName || KIND_TEXT[c.kind],
      c.durationSec ? formatDurationCN(c.durationSec) : '—',
      c.distanceKm ? `${formatNumber(c.distanceKm, 2)} km` : '—',
      c.paceText || formatPace(c.distanceKm ?? 0, c.durationSec),
      c.avgHr ? `${c.avgHr} bpm` : '—',
      c.playMin ? `${c.playMin} 分钟` : '—',
    ]);
    r.table(
      ['项目', '时长', '距离', '配速', '心率', '上场时间'],
      [96, 76, 62, 84, 62, CONTENT_W - 380],
      rows,
    );
  }

  // 身体数据与感受
  r.section('身体状态与感受');
  const pain = (summary.painSites ?? []).filter(Boolean).join('、') || '无';
  r.text(
    [
      `疼痛部位：${pain}`,
      `今日感受：${safeFileText(summary.feeling)}`,
      `训练备注：${safeFileText(summary.note)}`,
    ].join('\n'),
    { size: 10.5 },
  );

  // 近 7 天体重趋势（有数据时）
  const recent = (metrics ?? [])
    .filter((m) => m.weightKg != null)
    .slice(-7)
    .map((m) => ({ label: m.date.slice(5), value: m.weightKg as number }));
  if (recent.length >= 2) {
    r.section('近期体重趋势');
    r.table(
      ['日期', '体重'],
      [CONTENT_W / 2, CONTENT_W / 2],
      recent.map((x, i) => [
        x.label,
        `${formatNumber(x.value)} kg${i > 0 ? `（${x.value - recent[i - 1].value >= 0 ? '+' : ''}${formatNumber(x.value - recent[i - 1].value)}）` : ''}`,
      ]),
    );
  }

  if (dailyLog) {
    r.section('当日记录');
    const supp = dailyLog.supplements ?? {};
    r.text(
      [
        `补剂：${[
          supp.proteinG ? `蛋白粉 ${supp.proteinG}g` : '',
          supp.proteinScoops ? `${supp.proteinScoops} 勺` : '',
          supp.creatineG ? `肌酸 ${supp.creatineG}g` : '',
          supp.others || '',
        ]
          .filter(Boolean)
          .join('、') || '—'}`,
        `饮食：${safeFileText(dailyLog.diet)}`,
        `睡眠：${dailyLog.sleepHours != null ? `${formatNumber(dailyLog.sleepHours)} 小时` : '—'}`,
      ].join('\n'),
      { size: 10.5 },
    );
  }

  r.y -= 6;
  r.section('训练小结');
  r.text(buildInsightText(summary), { size: 10.5 });

  r.finishFooters();
  return r.doc.save();
}

function buildInsightText(s: WorkoutSummary): string {
  const bits: string[] = [];
  const rate = Math.round((s.completionRate || 0) * 100);
  if (rate >= 100) bits.push('今日计划全部完成，执行度满分。');
  else if (rate >= 70) bits.push(`今日完成率 ${rate}%，整体执行到位。`);
  else bits.push(`今日完成率 ${rate}%，可以检查一下训练安排是否过长。`);
  if (s.totalVolumeKg > 0) bits.push(`总训练容量 ${formatVolume(s.totalVolumeKg)}。`);
  if (s.rpe != null && s.rpe >= 9) bits.push('主观强度偏高，注意安排恢复日。');
  if (s.rpe != null && s.rpe <= 5) bits.push('主观强度偏低，下次可以适当加一点重量或次数。');
  if (s.skippedExercises.length) bits.push(`跳过：${s.skippedExercises.join('、')}。`);
  const pain = (s.painSites ?? []).filter(Boolean);
  if (pain.length) bits.push(`疼痛记录：${pain.join('、')}，如持续不适请咨询专业医生。`);
  return bits.join('');
}

/** 训练计划 PDF（把计划带去健身房也能看） */
export async function buildPlanPdf(
  plan: TrainingPlan,
  fonts: ReportFonts,
): Promise<Uint8Array> {
  const r = new Report();
  await r.init(fonts, `训练计划 · ${plan.title}`);
  r.header(plan.title, `${formatDateCN(plan.date)} · ${KIND_TEXT[plan.kind] ?? ''}`);

  r.grid(
    [
      { label: '动作数量', value: `${plan.exercises.length} 个` },
      { label: '预计时长', value: plan.estimatedMinutes ? `${plan.estimatedMinutes} 分钟` : '—' },
      { label: '训练类型', value: KIND_TEXT[plan.kind] ?? '—' },
    ],
    3,
  );

  if (plan.warmup.length) {
    r.section('热身');
    r.table(
      ['内容', '要求'],
      [150, CONTENT_W - 150],
      plan.warmup.map((w) => [w.name, w.detail ?? '—']),
    );
  }

  r.section('训练内容');
  r.table(
    ['动作', '目标', '要领与注意'],
    [140, 150, CONTENT_W - 290],
    plan.exercises.map((e) => [
      e.name,
      targetSummary(e.target),
      [e.cue, e.notes].filter(Boolean).join('；') || '—',
    ]),
  );

  if (plan.cooldown) {
    r.section('拉伸与恢复');
    r.text(plan.cooldown, { size: 10.5 });
  }
  if (plan.notes) {
    r.section('备注');
    r.text(plan.notes, { size: 10.5 });
  }

  r.finishFooters();
  return r.doc.save();
}
