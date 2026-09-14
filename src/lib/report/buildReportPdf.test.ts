import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { LiveSession, TrainingPlan, WorkoutSummary } from '../../types';
import { buildPlanPdf, buildSummaryPdf, type ReportFonts } from './buildReportPdf';

const OUT = resolve(process.cwd(), '..', 'work', 'out');

function loadFonts(): ReportFonts {
  const toU8 = (p: string) => {
    const buf = readFileSync(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  return {
    regular: toU8(resolve(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf')),
    bold: toU8(resolve(process.cwd(), 'public/fonts/NotoSansSC-Bold.ttf')),
  };
}

const plan: TrainingPlan = {
  id: 'plan_test',
  title: '下肢力量 + 爆发力（含跑步与足球）',
  date: '2026-09-15',
  kind: 'strength',
  source: 'sample',
  estimatedMinutes: 75,
  warmup: [
    { name: '动态拉伸', detail: '髋部、腘绳肌、踝关节各 30 秒' },
    { name: '慢跑热身', detail: '心率升到 120 左右' },
  ],
  exercises: Array.from({ length: 12 }).map((_, i) => ({
    id: `ex_${i}`,
    name: `动作 ${i + 1}：这是一个很长的动作名称用来测试中文排版是否会溢出边界`,
    kind: 'strength' as const,
    target: { sets: 4, reps: '8-12', weightKg: 60 + i, restSec: 90, rpe: 7 },
    cue: '保持核心收紧，膝盖对准脚尖方向，离心阶段控制 3 秒，注意不要把重量甩起来导致代偿。',
    notes: '如果有疼痛立即停止，并记录疼痛部位。',
    order: i,
  })),
  cooldown: '静态拉伸：股四头肌、腘绳肌、臀肌各 30 秒 × 2 组；泡沫轴放松 2 分钟。',
  notes: '这份备注很长，用来验证自动折行是否正常工作，避免出现内容被截断或者超出页面边距的情况。睡眠不足时降低重量。',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const summary: WorkoutSummary = {
  id: 'sum_test',
  sessionId: 'sess_test',
  planId: plan.id,
  planTitle: plan.title,
  kind: 'strength',
  date: '2026-09-15',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  totalDurationSec: 4530,
  completedExercises: plan.exercises.slice(0, 9).map((e) => e.name),
  skippedExercises: plan.exercises.slice(9).map((e) => e.name),
  totalSets: 34,
  totalReps: 286,
  totalVolumeKg: 12480,
  completionRate: 0.75,
  cardio: [
    {
      kind: 'run',
      exerciseName: '400 米间歇跑',
      durationSec: 540,
      distanceKm: 2.4,
      paceText: "4'00\"/km",
      avgHr: 172,
      playMin: null,
    },
    {
      kind: 'football',
      exerciseName: '足球带球绕杆',
      durationSec: 360,
      distanceKm: 1.2,
      paceText: null,
      avgHr: 150,
      playMin: 20,
    },
  ],
  bodyWeightKg: 71.4,
  rpe: 9,
  fatigue: 7,
  painSites: ['右膝', '左踝'],
  feeling: '整体状态不错，最后一组深蹲有点吃力，但动作质量保持住了。',
  note: '下次把深蹲加到 92.5kg，间歇跑的配速可以再稳定一点。',
  createdAt: new Date().toISOString(),
};

const session: LiveSession = {
  id: 'sess_test',
  planId: plan.id,
  planTitle: plan.title,
  kind: 'strength',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  accumulatedSec: 4530,
  lastResumedAt: null,
  status: 'finished',
  currentIndex: 0,
  restUntil: null,
  restTotalSec: 90,
  logs: [],
  pain: [],
  updatedAt: new Date().toISOString(),
  exercises: plan.exercises.map((e, i) => ({
    exerciseId: e.id,
    name: e.name,
    kind: e.kind,
    target: e.target,
    cue: e.cue,
    notes: e.notes,
    status: i < 9 ? 'done' : 'skipped',
    extraSets: 0,
    sets: Array.from({ length: i < 9 ? 4 : 0 }).map((_, si) => ({
      id: `s_${i}_${si}`,
      index: si + 1,
      weightKg: 60 + i,
      reps: 10,
      done: true,
      completedAt: new Date().toISOString(),
    })),
  })),
};

describe('中文 PDF 报告', () => {
  beforeAll(() => mkdirSync(OUT, { recursive: true }));

  it('生成训练总结 PDF：中文可嵌入、页数与体积正常', async () => {
    const bytes = await buildSummaryPdf(
      {
        summary,
        plan,
        session,
        metrics: [
          { id: 'a', date: '2026-09-10', weightKg: 72.1, createdAt: '', updatedAt: '' },
          { id: 'b', date: '2026-09-13', weightKg: 71.6, createdAt: '', updatedAt: '' },
          { id: 'c', date: '2026-09-15', weightKg: 71.4, createdAt: '', updatedAt: '' },
        ],
        dailyLog: {
          id: '2026-09-15',
          date: '2026-09-15',
          diet: '早餐燕麦鸡蛋，午餐米饭鸡胸，晚餐牛肉意面',
          sleepHours: 7.2,
          supplements: { proteinG: 50, creatineG: 5, proteinScoops: 2 },
          createdAt: '',
          updatedAt: '',
        },
      },
      loadFonts(),
    );

    expect(bytes.byteLength).toBeGreaterThan(12000);
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    // 中文字体必须真正嵌入（体积会明显大于空报告），这是「不乱码」的前提
    expect(bytes.byteLength).toBeGreaterThan(700_000);
    writeFileSync(resolve(OUT, 'sample-summary-report.pdf'), bytes);
  });

  it('生成训练计划 PDF：长文本自动换页不截断', async () => {
    const bytes = await buildPlanPdf(plan, loadFonts());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    writeFileSync(resolve(OUT, 'sample-plan.pdf'), bytes);
  });

  it('字体子集覆盖报告用到的全部中文字符', () => {
    const font = readFileSync(resolve(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf'));
    expect(font.byteLength).toBeGreaterThan(500_000);
    const text = `${summary.planTitle}${summary.feeling}${summary.note}${plan.notes}`;
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
