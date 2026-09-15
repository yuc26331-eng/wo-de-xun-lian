/**
 * 「一键导出给 ChatGPT」：把任意日期范围内的每日原始记录整理成
 * Markdown / 纯文本 / JSON / 中文 PDF（带文字层，可复制可搜索）。
 *
 * 原则：
 * - 只搬运和汇总用户填写过的原始数据，不猜测、不编造
 * - 没记录的项目统一标注「未记录」
 * - 只做简单统计，不给医学诊断或专业训练结论
 */
import type {
  AttachmentMeta,
  BodyMetric,
  DailyLog,
  ISODate,
  WorkoutSummary,
} from '../../types';
import { SESSION_KIND_LABEL } from '../../types';
import {
  addDays,
  dayDiff,
  formatDurationCN,
  formatNumber,
  formatVolume,
  parseISODate,
} from '../format';
import { flattenSection, normalizeDailyLog, type SectionKey } from '../summary/sections';

export interface ExportInclude {
  training: boolean;
  watch: boolean;
  sleep: boolean;
  body: boolean;
  diet: boolean;
  notes: boolean;
}

export const DEFAULT_INCLUDE: ExportInclude = {
  training: true,
  watch: true,
  sleep: true,
  body: true,
  diet: true,
  notes: true,
};

export interface ExportContext {
  dailyLogs: DailyLog[];
  summaries: WorkoutSummary[];
  bodyMetrics: BodyMetric[];
  attachments: AttachmentMeta[];
}

export interface DayBundle {
  date: ISODate;
  log: DailyLog | null;
  summaries: WorkoutSummary[];
  metric: BodyMetric | null;
  watchShots: number;
  sleepShots: number;
  /** 是否完全没有记录 */
  empty: boolean;
}

export interface RangeSummary {
  start: ISODate;
  end: ISODate;
  dayCount: number;
  recordedDays: number;
  missingDates: ISODate[];
  trainingCount: number;
  footballCount: number;
  strengthCount: number;
  runCount: number;
  rideCount: number;
  totalDurationSec: number;
  totalRunKm: number;
  avgRpe: number | null;
  avgSleepHours: number | null;
  avgRestingHr: number | null;
  avgHrv: number | null;
  weightStart: number | null;
  weightEnd: number | null;
  weightDelta: number | null;
  painList: { date: ISODate; text: string }[];
}

const MISSING = '未记录';

function listDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const diff = dayDiff(end, start);
  for (let i = 0; i <= diff; i += 1) out.push(addDays(start, i));
  return out;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 组装日期范围内的每日数据 */
export function buildRangeData(
  start: ISODate,
  end: ISODate,
  ctx: ExportContext,
): DayBundle[] {
  const dates = listDates(start, end);
  return dates.map((date) => {
    const raw = ctx.dailyLogs.find((d) => d.date === date) ?? null;
    const log = raw ? normalizeDailyLog(raw, date) : null;
    const summaries = ctx.summaries.filter((s) => s.date === date);
    const metric = ctx.bodyMetrics.find((m) => m.date === date) ?? null;
    const shots = ctx.attachments.filter((a) => a.date === date);
    const empty = !raw && summaries.length === 0 && !metric;
    return {
      date,
      log,
      summaries,
      metric,
      watchShots: shots.filter((a) => a.kind === 'watch').length,
      sleepShots: shots.filter((a) => a.kind === 'sleep').length,
      empty,
    };
  });
}

/** 日期范围汇总（只统计有记录的数值） */
export function buildRangeSummary(days: DayBundle[]): RangeSummary {
  const missingDates = days.filter((d) => d.empty).map((d) => d.date);
  const summaries = days.flatMap((d) => d.summaries);
  const rpes: number[] = [];
  const sleeps: number[] = [];
  const resting: number[] = [];
  const hrvs: number[] = [];
  const weights: { date: ISODate; value: number }[] = [];
  const painList: { date: ISODate; text: string }[] = [];
  let totalDurationSec = 0;
  let totalRunKm = 0;

  for (const s of summaries) {
    totalDurationSec += s.totalDurationSec ?? 0;
    if (s.rpe != null) rpes.push(s.rpe);
    totalRunKm += s.cardio
      .filter((c) => c.kind === 'run')
      .reduce((n, c) => n + (c.distanceKm ?? 0), 0);
  }

  for (const day of days) {
    const log = day.log;
    const sleepSec = log ? flattenSection(log, 'sleep') : {};
    const watchSec = log ? flattenSection(log, 'watch') : {};
    const bodySec = log ? flattenSection(log, 'body') : {};

    const sleepHours =
      num(sleepSec.totalHours) ??
      (day.metric?.sleepHours != null ? day.metric.sleepHours : null);
    if (sleepHours != null) sleeps.push(sleepHours);

    const restingHr = num(watchSec.restingHr) ?? num(day.metric?.restingHr);
    if (restingHr != null) resting.push(restingHr);
    const hrv = num(watchSec.hrvMs);
    if (hrv != null) hrvs.push(hrv);

    const weight = num(bodySec.weightKg) ?? num(day.metric?.weightKg);
    if (weight != null) weights.push({ date: day.date, value: weight });

    const rpe = num(bodySec.rpe) ?? num(log?.training?.rpe) ?? num(log?.rpe);
    if (rpe != null) rpes.push(rpe);

    const pain = [
      text(bodySec.injuryPain),
      log?.training?.painSites?.join('、') ?? '',
    ]
      .filter(Boolean)
      .join('；');
    if (pain) painList.push({ date: day.date, text: pain });
  }

  const avg = (arr: number[]): number | null =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

  const sortedWeights = [...weights].sort((a, b) => (a.date < b.date ? -1 : 1));
  const weightStart = sortedWeights[0]?.value ?? null;
  const weightEnd = sortedWeights[sortedWeights.length - 1]?.value ?? null;

  const count = (pred: (s: WorkoutSummary) => boolean) => summaries.filter(pred).length;

  return {
    start: days[0]?.date ?? '',
    end: days[days.length - 1]?.date ?? '',
    dayCount: days.length,
    recordedDays: days.length - missingDates.length,
    missingDates,
    trainingCount: summaries.length,
    footballCount: count((s) => s.kind === 'football'),
    strengthCount: count((s) => s.kind === 'strength'),
    runCount: count((s) => s.kind === 'run'),
    rideCount: count((s) => s.kind === 'ride'),
    totalDurationSec,
    totalRunKm: Math.round(totalRunKm * 100) / 100,
    avgRpe: avg(rpes),
    avgSleepHours: avg(sleeps),
    avgRestingHr: avg(resting),
    avgHrv: avg(hrvs),
    weightStart,
    weightEnd,
    weightDelta:
      weightStart != null && weightEnd != null
        ? Math.round((weightEnd - weightStart) * 10) / 10
        : null,
    painList,
  };
}

const line = (label: string, value: unknown, unit = ''): string => {
  if (value == null || value === '') return `- ${label}：${MISSING}`;
  if (typeof value === 'number') return `- ${label}：${formatNumber(value)}${unit}`;
  return `- ${label}：${String(value)}`;
};

/** 单个动作明细（保留原始重量、次数、组数） */
function exerciseLines(summary: WorkoutSummary): string[] {
  const lines: string[] = [];
  if (summary.completedExercises.length) {
    lines.push(`- 完成动作：${summary.completedExercises.join('、')}`);
  }
  if (summary.skippedExercises.length) {
    lines.push(`- 跳过动作：${summary.skippedExercises.join('、')}`);
  }
  lines.push(
    line('总组数', summary.totalSets ? summary.totalSets : null, ' 组'),
    line('总次数', summary.totalReps ? summary.totalReps : null, ' 次'),
    line('总容量', summary.totalVolumeKg ? formatVolume(summary.totalVolumeKg) : null),
  );
  return lines;
}

function daySectionMarkdown(day: DayBundle, include: ExportInclude): string {
  const d = parseISODate(day.date);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const out: string[] = [`## ${day.date}（${weekday}）`];
  const log = day.log;
  if (day.empty) out.push('> 这一天没有任何记录。');

  if (include.training) {
    out.push('### 训练情况');
    if (day.summaries.length === 0 && !log?.training) {
      out.push(`- 训练：${MISSING}`);
    } else {
      const t = log ? flattenSection(log, 'training') : {};
      const summary = day.summaries[0];
      if (summary) {
        out.push(
          line('训练项目', summary.planTitle),
          line('训练类型', SESSION_KIND_LABEL[summary.kind] ?? summary.kind),
          line('训练时长', summary.totalDurationSec ? formatDurationCN(summary.totalDurationSec) : null),
          line('完成率', summary.completionRate != null ? Math.round(summary.completionRate * 100) : null, '%'),
          ...exerciseLines(summary),
        );
        if (summary.cardio.length) {
          for (const c of summary.cardio) {
            const bits = [
              c.durationSec ? formatDurationCN(c.durationSec) : '',
              c.distanceKm ? `${formatNumber(c.distanceKm, 2)} km` : '',
              c.paceText ? `配速 ${c.paceText}` : '',
              c.speedKph ? `${formatNumber(c.speedKph)} km/h` : '',
              c.avgHr ? `平均心率 ${c.avgHr}` : '',
              c.playMin ? `上场 ${c.playMin} 分钟` : '',
            ].filter(Boolean);
            out.push(`- 有氧记录（${SESSION_KIND_LABEL[c.kind] ?? c.kind}）：${bits.join('，') || MISSING}`);
          }
        }
      }
      if (log?.training) {
        out.push(
          line('手填·训练项目', text(t.items) || null),
          line('手填·动作组数次数重量', text(t.exercises) || null),
          line('手填·训练时长', num(t.durationMin), ' 分钟'),
          line('手填·跑步距离', num(t.runDistanceKm), ' km'),
          line('手填·跑步配速', text(t.runPaceText) || null),
          line('手填·完成度', num(t.completionPct), '%'),
          line('手填·训练感受', text(t.feeling) || null),
          line('手填·比赛/足球表现', text(t.matchPerformance) || null),
        );
      }
      const rpe = num(t.rpe) ?? num(day.summaries[0]?.rpe);
      out.push(line('RPE / 主观强度', rpe));
      const painSites = (log?.training?.painSites ?? []).join('、');
      out.push(line('疼痛与不适部位', painSites || text(log?.body?.injuryPain) || null));
    }
  }

  if (include.watch) {
    out.push('### Apple Watch 与运动数据');
    const w = log ? flattenSection(log, 'watch') : {};
    out.push(
      line('活动能量', num(w.activeEnergyKcal), ' kcal'),
      line('总消耗', num(w.totalEnergyKcal), ' kcal'),
      line('步数', num(w.steps), ' 步'),
      line('运动分钟数', num(w.exerciseMinutes), ' 分钟'),
      line('站立时间', num(w.standHours), ' 小时'),
      line('平均心率', num(w.avgHr), ' bpm'),
      line('最高心率', num(w.maxHr), ' bpm'),
      line('静息心率', num(w.restingHr), ' bpm'),
      line('心率恢复', num(w.hrRecovery), ' bpm'),
      line('HRV', num(w.hrvMs), ' ms'),
      line('血氧', num(w.bloodOxygenPct), ' %'),
      line('用户备注', text(w.note) || null),
    );
    if (day.watchShots) out.push(`- Apple Watch 截图附件：${day.watchShots} 张（保存在本机）`);
  }

  if (include.sleep) {
    out.push('### 睡眠情况');
    const s = log ? flattenSection(log, 'sleep') : {};
    out.push(
      line('上床时间', text(s.bedTime) || null),
      line('入睡时间', text(s.sleepTime) || null),
      line('起床时间', text(s.wakeTime) || null),
      line('总睡眠时长', num(s.totalHours) ?? num(day.metric?.sleepHours), ' 小时'),
      line('深度睡眠', num(s.deepHours), ' 小时'),
      line('核心睡眠', num(s.coreHours), ' 小时'),
      line('REM 睡眠', num(s.remHours), ' 小时'),
      line('夜间清醒', num(s.awakeHours), ' 小时'),
      line('午睡', num(s.napMinutes), ' 分钟'),
      line('主观睡眠质量', num(s.quality), ' / 5'),
      line('睡眠备注', text(s.note) || null),
    );
    if (day.sleepShots) out.push(`- 睡眠截图附件：${day.sleepShots} 张（保存在本机）`);
  }

  if (include.body) {
    out.push('### 身体与恢复');
    const b = log ? flattenSection(log, 'body') : {};
    out.push(
      line('体重', num(b.weightKg) ?? num(day.metric?.weightKg), ' kg'),
      line('体脂率', num(b.bodyFatPct) ?? num(day.metric?.bodyFatPct), ' %'),
      line('疲劳程度', num(b.fatigue), ' / 5'),
      line('肌肉酸痛', num(b.soreness) ?? num(day.metric?.soreness), ' / 5'),
      line('精神状态', num(b.mood), ' / 5'),
      line('食欲', num(b.appetite), ' / 5'),
      line('压力', num(b.stress), ' / 5'),
      line('伤病或疼痛', text(b.injuryPain) || null),
      line('恢复情况', num(b.recovery) ?? num(day.metric?.recovery), ' / 5'),
      line('当天整体感受', text(b.overall) || null),
    );
  }

  if (include.diet) {
    out.push('### 饮食与补剂');
    const m = log ? flattenSection(log, 'diet') : {};
    const extraSupp = Array.isArray(m.supplementsList) ? (m.supplementsList as string[]) : [];
    out.push(
      line('早餐', text(m.breakfast) || null),
      line('午餐', text(m.lunch) || null),
      line('晚餐', text(m.dinner) || null),
      line('加餐', text(m.snack) || null),
      line('饮水量', num(m.waterMl) ?? num(day.metric?.waterMl), ' ml'),
      line('蛋白粉', num(m.proteinG) ?? num(day.metric?.proteinG), ' g'),
      line('肌酸', num(m.creatineG), ' g'),
      line('咖啡因', num(m.caffeineMg), ' mg'),
      line('补剂清单', extraSupp.length ? extraSupp.join('、') : null),
      line('补剂情况', text(m.noSupplements) || null),
      line('其他补剂', text(m.others) || null),
      line('饮食备注', text(m.note) || null),
    );
  }

  if (include.notes) {
    out.push('### 用户备注（原话）');
    const free = log ? text(flattenSection(log, 'notes').freeNote) : '';
    out.push(free ? `> ${free}` : `- ${MISSING}`);
  }

  return out.join('\n');
}

export const CHATGPT_PREAMBLE =
  '请根据以下日期范围内的原始训练、Apple Watch、睡眠、身体状态和饮食记录，' +
  '对我的训练负荷、恢复、睡眠、身体异常和整体状态进行综合分析。' +
  '请区分事实、推测和建议，不要编造未记录的数据，并生成一份按日期和整体趋势整理的今日总结报告。';

export const DISCLAIMER =
  '本文件由「我的训练」按用户填写的原始数据自动整理与汇总，仅做数据整理，不构成医学诊断或专业训练结论。';

function summaryLines(summary: RangeSummary): string[] {
  const delta =
    summary.weightDelta == null
      ? MISSING
      : `${summary.weightDelta > 0 ? '+' : ''}${formatNumber(summary.weightDelta)} kg`;
  return [
    `- 日期范围：${summary.start} ~ ${summary.end}（共 ${summary.dayCount} 天，有记录 ${summary.recordedDays} 天）`,
    `- 总训练次数：${summary.trainingCount} 次`,
    `- 总训练时长：${summary.totalDurationSec ? formatDurationCN(summary.totalDurationSec) : MISSING}`,
    `- 足球训练次数：${summary.footballCount} 次`,
    `- 力量训练次数：${summary.strengthCount} 次`,
    `- 跑步训练次数：${summary.runCount} 次（骑行 ${summary.rideCount} 次）`,
    `- 跑步总距离：${summary.totalRunKm ? `${formatNumber(summary.totalRunKm, 2)} km` : MISSING}`,
    `- 平均 RPE：${summary.avgRpe ?? MISSING}`,
    `- 平均睡眠时长：${summary.avgSleepHours != null ? `${formatNumber(summary.avgSleepHours)} 小时` : MISSING}`,
    `- 平均静息心率：${summary.avgRestingHr != null ? `${formatNumber(summary.avgRestingHr)} bpm` : MISSING}`,
    `- 平均 HRV：${summary.avgHrv != null ? `${formatNumber(summary.avgHrv)} ms` : MISSING}`,
    `- 体重变化：${summary.weightStart ?? MISSING}${summary.weightEnd != null ? ` → ${formatNumber(summary.weightEnd)} kg（${delta}）` : ''}`,
    `- 疼痛与异常情况：${
      summary.painList.length
        ? summary.painList.map((p) => `${p.date} ${p.text}`).join('；')
        : MISSING
    }`,
    `- 数据缺失日期：${summary.missingDates.length ? summary.missingDates.join('、') : '无'}`,
  ];
}

/** Markdown（为 ChatGPT 优化：开头带固定说明） */
export function toMarkdown(
  days: DayBundle[],
  summary: RangeSummary,
  include: ExportInclude,
): string {
  const header = [
    '# 训练与恢复记录',
    '',
    `> ${CHATGPT_PREAMBLE}`,
    '',
    `日期范围：${summary.start} ~ ${summary.end}`,
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
  ];
  const body = days.map((d) => daySectionMarkdown(d, include)).join('\n\n---\n\n');
  const tail = ['', '---', '', '# 日期范围汇总', ...summaryLines(summary), '', `> ${DISCLAIMER}`];
  return [...header, body, ...tail].join('\n');
}

/** 纯文本（同样的内容，去掉 Markdown 记号） */
export function toPlainText(
  days: DayBundle[],
  summary: RangeSummary,
  include: ExportInclude,
): string {
  const md = toMarkdown(days, summary, include);
  return md
    .replace(/^>\s?/gm, '')
    .replace(/^###\s*/gm, '')
    .replace(/^##\s*/gm, '')
    .replace(/^#\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^---$/gm, '———');
}

/** JSON（结构化，方便程序处理） */
export function toJson(days: DayBundle[], summary: RangeSummary, include: ExportInclude): string {
  const payload = {
    app: 'wo-de-xun-lian',
    exportedAt: new Date().toISOString(),
    range: { start: summary.start, end: summary.end },
    instruction: CHATGPT_PREAMBLE,
    disclaimer: DISCLAIMER,
    includes: include,
    days: days.map((d) => ({
      date: d.date,
      training: include.training
        ? {
            records: d.summaries,
            manual: d.log?.training ?? null,
          }
        : undefined,
      watch: include.watch ? (d.log?.watch ?? null) : undefined,
      sleep: include.sleep
        ? { ...(d.log?.sleep ?? null), fromMetric: d.metric?.sleepHours ?? null }
        : undefined,
      body: include.body
        ? {
            ...(d.log?.body ?? null),
            metric: d.metric
              ? { weightKg: d.metric.weightKg, bodyFatPct: d.metric.bodyFatPct }
              : null,
          }
        : undefined,
      diet: include.diet
        ? { meals: d.log?.meals ?? null, supplements: d.log?.supplements ?? null }
        : undefined,
      notes: include.notes ? (d.log?.freeNote ?? null) : undefined,
      attachments: { watch: d.watchShots, sleep: d.sleepShots },
    })),
    summary,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportFileName(start: ISODate, end: ISODate, ext: string): string {
  const base = start === end ? `训练与恢复记录_${start}` : `训练与恢复记录_${start}_${end}`;
  return `${base}.${ext}`;
}

export const SECTION_ORDER: SectionKey[] = ['training', 'watch', 'sleep', 'body', 'diet', 'notes'];
