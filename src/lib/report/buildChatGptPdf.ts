/** 「给 ChatGPT 分析」报告 PDF：真实文字层（可复制、可搜索），按日期从早到晚排版 */
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { ISODate } from '../../types';
import { formatDateCN, formatDurationCN, formatNumber, parseISODate } from '../format';
import { Report, type ReportFonts } from './buildReportPdf';
import {
  CHATGPT_PREAMBLE,
  DISCLAIMER,
  buildRangeSummary,
  type DayBundle,
  type ExportInclude,
  type RangeSummary,
} from './chatgptExport';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export interface ChatGptPdfInput {
  days: DayBundle[];
  include: ExportInclude;
  summary?: RangeSummary;
}

/** 把「每天一节的 Markdown 段落」转成排版整齐的 PDF */
export async function buildChatGptRangePdf(
  input: ChatGptPdfInput,
  fonts: ReportFonts,
): Promise<Uint8Array> {
  const { days, include } = input;
  const summary = input.summary ?? buildRangeSummary(days);
  const r = new Report();
  await r.init(fonts, `训练与恢复记录 ${summary.start} ~ ${summary.end}`);
  r.header('训练与恢复记录', `${summary.start} ~ ${summary.end} · 共 ${summary.dayCount} 天`);

  r.section('给 ChatGPT 的说明');
  r.text(CHATGPT_PREAMBLE, { size: 10 });
  r.text(DISCLAIMER, { size: 9, color: undefined, gapAfter: 4 });

  r.section('日期范围汇总');
  r.grid(
    [
      { label: '总训练次数', value: `${summary.trainingCount} 次` },
      { label: '总训练时长', value: summary.totalDurationSec ? formatDurationCN(summary.totalDurationSec) : '未记录' },
      { label: '跑步总距离', value: summary.totalRunKm ? `${formatNumber(summary.totalRunKm, 2)} km` : '未记录' },
      { label: '足球 / 力量', value: `${summary.footballCount} / ${summary.strengthCount} 次` },
      { label: '平均 RPE', value: summary.avgRpe != null ? String(summary.avgRpe) : '未记录' },
      { label: '有记录天数', value: `${summary.recordedDays} / ${summary.dayCount} 天` },
    ],
    3,
  );
  r.text(
    [
      `平均睡眠时长：${summary.avgSleepHours != null ? `${formatNumber(summary.avgSleepHours)} 小时` : '未记录'}`,
      `平均静息心率：${summary.avgRestingHr != null ? `${formatNumber(summary.avgRestingHr)} bpm` : '未记录'}`,
      `平均 HRV：${summary.avgHrv != null ? `${formatNumber(summary.avgHrv)} ms` : '未记录'}`,
      `体重变化：${
        summary.weightStart != null && summary.weightEnd != null
          ? `${formatNumber(summary.weightStart)} → ${formatNumber(summary.weightEnd)} kg（${
              summary.weightDelta && summary.weightDelta > 0 ? '+' : ''
            }${formatNumber(summary.weightDelta ?? 0)}）`
          : '未记录'
      }`,
      `数据缺失日期：${summary.missingDates.length ? summary.missingDates.join('、') : '无'}`,
      `疼痛与异常情况：${
        summary.painList.length
          ? summary.painList.map((p) => `${p.date} ${p.text}`).join('；')
          : '未记录'
      }`,
    ].join('\n'),
    { size: 10 },
  );

  for (const day of days) {
    const d = parseISODate(day.date);
    r.section(`${day.date}（${WEEKDAY[d.getDay()]}）`);
    if (day.empty) {
      r.text('这一天没有任何记录。', { size: 10 });
      continue;
    }
    for (const block of dayBlocks(day, include)) {
      r.text(block.title, { size: 11, bold: true, gapAfter: 2 });
      r.text(block.lines.map((l) => `· ${l}`).join('\n'), { size: 10, gapAfter: 6 });
    }
  }

  r.finishFooters();
  return r.doc.save();
}

interface Block {
  title: string;
  lines: string[];
}

const MISSING = '未记录';
const val = (label: string, value: unknown, unit = ''): string => {
  if (value == null || value === '') return `${label}：${MISSING}`;
  if (typeof value === 'number') return `${label}：${formatNumber(value)}${unit}`;
  return `${label}：${String(value)}`;
};

/** 与 Markdown 版一致的六个分区（保持「事实优先、缺项标未记录」） */
export function dayBlocks(day: DayBundle, include: ExportInclude): Block[] {
  const blocks: Block[] = [];
  const log = day.log;

  if (include.training) {
    const lines: string[] = [];
    const summary = day.summaries[0];
    if (summary) {
      lines.push(
        val('训练项目', summary.planTitle),
        val('训练时长', summary.totalDurationSec ? formatDurationCN(summary.totalDurationSec) : null),
        val('完成率', summary.completionRate != null ? Math.round(summary.completionRate * 100) : null, '%'),
        val('完成动作', summary.completedExercises.join('、') || null),
        val('跳过动作', summary.skippedExercises.join('、') || null),
        val('总组数 / 总次数', summary.totalSets || summary.totalReps ? `${summary.totalSets} / ${summary.totalReps}` : null),
        val('总容量', summary.totalVolumeKg ? `${Math.round(summary.totalVolumeKg)} kg` : null),
      );
      for (const c of summary.cardio) {
        const bits = [
          c.durationSec ? formatDurationCN(c.durationSec) : '',
          c.distanceKm ? `${formatNumber(c.distanceKm, 2)} km` : '',
          c.paceText ? `配速 ${c.paceText}` : '',
          c.avgHr ? `平均心率 ${c.avgHr}` : '',
          c.playMin ? `上场 ${c.playMin} 分钟` : '',
        ].filter(Boolean);
        lines.push(`有氧记录（${c.exerciseName}）：${bits.join('，') || MISSING}`);
      }
    }
    if (log?.training) {
      const t = log.training;
      lines.push(
        val('训练项目（手填）', t.items ?? null),
        val('动作 / 组数 / 次数 / 重量', t.exercises ?? null),
        val('训练时长（手填）', t.durationMin, ' 分钟'),
        val('跑步距离（手填）', t.runDistanceKm, ' km'),
        val('跑步配速（手填）', t.runPaceText ?? null),
        val('完成度（手填）', t.completionPct, '%'),
        val('比赛 / 足球表现', t.matchPerformance ?? null),
        val('训练感受', t.feeling ?? null),
      );
    }
    lines.push(
      val('RPE / 主观强度', log?.training?.rpe ?? summary?.rpe ?? log?.rpe ?? null),
      val('疼痛与不适部位', (log?.training?.painSites ?? []).join('、') || log?.body?.injuryPain || null),
    );
    blocks.push({ title: '训练情况', lines });
  }

  if (include.watch) {
    const w = log?.watch ?? {};
    blocks.push({
      title: 'Apple Watch 与运动数据',
      lines: [
        val('活动能量', w.activeEnergyKcal, ' kcal'),
        val('总消耗', w.totalEnergyKcal, ' kcal'),
        val('步数', w.steps, ' 步'),
        val('运动分钟数', w.exerciseMinutes, ' 分钟'),
        val('站立时间', w.standHours, ' 小时'),
        val('平均心率', w.avgHr, ' bpm'),
        val('最高心率', w.maxHr, ' bpm'),
        val('静息心率', w.restingHr, ' bpm'),
        val('心率恢复', w.hrRecovery, ' bpm'),
        val('HRV', w.hrvMs, ' ms'),
        val('血氧', w.bloodOxygenPct, ' %'),
        val('用户备注', w.note ?? null),
        ...(day.watchShots ? [`Apple Watch 截图附件：${day.watchShots} 张（存放在本机）`] : []),
      ],
    });
  }

  if (include.sleep) {
    const s = log?.sleep ?? {};
    blocks.push({
      title: '睡眠情况',
      lines: [
        val('上床时间', s.bedTime ?? null),
        val('入睡时间', s.sleepTime ?? null),
        val('起床时间', s.wakeTime ?? null),
        val('总睡眠时长', s.totalHours ?? day.metric?.sleepHours ?? null, ' 小时'),
        val('深度睡眠', s.deepHours, ' 小时'),
        val('核心睡眠', s.coreHours, ' 小时'),
        val('REM 睡眠', s.remHours, ' 小时'),
        val('夜间清醒', s.awakeHours, ' 小时'),
        val('午睡', s.napMinutes, ' 分钟'),
        val('主观睡眠质量', s.quality, ' / 5'),
        val('睡眠备注', s.note ?? null),
        ...(day.sleepShots ? [`睡眠截图附件：${day.sleepShots} 张（存放在本机）`] : []),
      ],
    });
  }

  if (include.body) {
    const b = log?.body ?? {};
    blocks.push({
      title: '身体与恢复',
      lines: [
        val('体重', b.weightKg ?? day.metric?.weightKg ?? null, ' kg'),
        val('体脂率', b.bodyFatPct ?? day.metric?.bodyFatPct ?? null, ' %'),
        val('疲劳程度', b.fatigue, ' / 5'),
        val('肌肉酸痛', b.soreness ?? day.metric?.soreness ?? null, ' / 5'),
        val('精神状态', b.mood, ' / 5'),
        val('食欲', b.appetite, ' / 5'),
        val('压力', b.stress, ' / 5'),
        val('伤病或疼痛', b.injuryPain ?? null),
        val('恢复情况', b.recovery ?? day.metric?.recovery ?? null, ' / 5'),
        val('当天整体感受', b.overall ?? null),
      ],
    });
  }

  if (include.diet) {
    const m = log?.meals ?? {};
    const s = log?.supplements ?? {};
    const extraSupp = (log?.supplementsList ?? []).map(
      (x) => `${x.name}${x.amount ? ` ${x.amount}${x.unit ?? ''}` : ''}`,
    );
    blocks.push({
      title: '饮食与补剂',
      lines: [
        val('早餐', m.breakfast ?? null),
        val('午餐', m.lunch ?? null),
        val('晚餐', m.dinner ?? null),
        val('加餐', m.snack ?? null),
        val('饮水量', m.waterMl ?? day.metric?.waterMl ?? null, ' ml'),
        val('蛋白粉', s.proteinG ?? day.metric?.proteinG ?? null, ' g'),
        val('肌酸', s.creatineG, ' g'),
        val('咖啡因', s.caffeineMg, ' mg'),
        val('补剂清单', extraSupp.length ? extraSupp.join('、') : null),
        val('补剂情况', log?.noSupplements ? '今天没吃补剂' : null),
        val('其他补剂', s.others ?? null),
        val('饮食备注', m.note ?? null),
      ],
    });
  }

  if (include.notes) {
    blocks.push({
      title: '用户备注（原话）',
      lines: [log?.freeNote?.trim() || MISSING],
    });
  }

  return blocks;
}

/** 供单元测试使用：判断一份 PDF 是否包含文字层（而不是图片） */
export async function pdfHasTextLayer(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes);
  let fontCount = 0;
  let imageCount = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict =
      obj instanceof PDFDict ? obj : ((obj as unknown as { dict?: PDFDict }).dict ?? null);
    if (!dict || typeof dict.get !== 'function') continue;
    const type = dict.get(PDFName.of('Type'))?.toString();
    const subtype = dict.get(PDFName.of('Subtype'))?.toString();
    if (type === '/Font' || dict.get(PDFName.of('BaseFont')) !== undefined) fontCount += 1;
    if (subtype === '/Image') imageCount += 1;
  }
  // 有字体资源、且没有任何图片对象 → 是真文字层而不是扫描图片
  return doc.getPageCount() > 0 && fontCount > 0 && imageCount === 0;
}

export function pdfFileName(start: ISODate, end: ISODate): string {
  return start === end
    ? `训练与恢复记录_${start}.pdf`
    : `训练与恢复记录_${start}_${end}.pdf`;
}

/** 供界面展示的日期标题 */
export function rangeTitle(start: ISODate, end: ISODate): string {
  return start === end ? formatDateCN(start) : `${start} ~ ${end}`;
}
