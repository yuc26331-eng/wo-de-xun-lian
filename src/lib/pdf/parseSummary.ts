/** 今日训练总结解析：PDF 文本 -> SummaryDraft */
import type { SummaryDraft } from '../../types';
import { toISODate } from '../format';
import { cleanLines, firstNumber, matchLabel, normalizeText, parseDateLoose } from './text';

function findLabelValue(lines: string[], labels: string[], mode: 'value' | 'rest' = 'rest'): string | null {
  for (const line of lines) {
    const hit = matchLabel(line, labels, mode);
    if (hit) return hit.value;
  }
  return null;
}

function numberFrom(lines: string[], labels: string[], pattern?: RegExp): number | null {
  for (const line of lines) {
    const hit = matchLabel(line, labels);
    if (!hit) continue;
    const n = firstNumber(hit.value);
    if (n != null) return n;
  }
  if (pattern) {
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      const n = firstNumber(line);
      if (n != null) return n;
    }
  }
  return null;
}

/** 训练量：'8420kg' / '8.4吨' / '12.5 t' */
function parseVolume(lines: string[]): number | null {
  for (const line of lines) {
    const hit = matchLabel(line, ['训练量', '训练容量', '总容量', '总训练量', '容量', 'volume']);
    if (!hit) continue;
    const source = hit.value;
    const ton = source.match(/(\d+(?:\.\d+)?)\s*(?:吨|t\b)/i);
    if (ton) return Math.round(Number(ton[1]) * 1000);
    const kg = source.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:kg|公斤|千克)/i);
    if (kg) return Math.round(Number(kg[1].replace(/,/g, '')));
    const bare = source.match(/(\d[\d,]{2,7})/);
    if (bare) return Number(bare[1].replace(/,/g, ''));
  }
  return null;
}

export function parseSummaryText(
  text: string,
  opts: { fileName?: string; importId: string; today?: string },
): SummaryDraft {
  const lines = cleanLines(text);
  const warnings: string[] = [];

  const date =
    lines.map((l) => parseDateLoose(l)).find((d) => d) ??
    parseDateLoose(opts.fileName ?? '') ??
    opts.today ??
    toISODate();

  const weightKg =
    numberFrom(lines, ['体重', '今日体重', '晨重', '净重']) ??
    (() => {
      const m = text.match(/体重\s*[:：]?\s*(\d{2,3}(?:\.\d+)?)\s*(?:kg|公斤)/i);
      return m ? Number(m[1]) : null;
    })();

  const rpe = numberFrom(lines, ['RPE', '主观强度', '训练强度'], /rpe|强度/i);
  const sleepHours = numberFrom(lines, ['睡眠', '睡眠时长', '睡眠时间'], /小时|h|min|\d/);
  const fatigue = numberFrom(lines, ['疲劳程度', '疲劳', '疲劳感'], /疲劳|\d/);
  const trainingVolumeKg = parseVolume(lines);

  // 训练内容：优先「训练内容」标签，否则收集出现组次/动作关键词的行
  const contentHit = findLabelValue(lines, ['训练内容', '今日训练内容', '训练项目', '完成情况']);
  const contentLines = lines.filter(
    (l) =>
      !contentHit &&
      /(组|次|kg|公斤|@|深蹲|硬拉|卧推|推举|划船|跑步|跑|骑行|足球|拉伸)/.test(l) &&
      !/^(日期|时间|体重|心率|睡眠|饮食|补剂|备注|疼痛)/.test(l),
  );
  const trainingContent = (contentHit ?? contentLines.join('；')).replace(/\s{2,}/g, ' ').slice(0, 800);

  const diet = findLabelValue(lines, ['饮食', '饮食记录', '营养', '今日饮食']) ?? '';
  const pain = findLabelValue(lines, ['疼痛', '不适', '伤病', '疼痛部位']) ?? '';
  const feeling = findLabelValue(lines, ['感受', '今日感受', '状态', '自我感觉', '体感']) ?? '';
  const note = findLabelValue(lines, ['备注', '其他', '补充', '说明']) ?? '';

  // 补剂
  const proteinG = numberFrom(lines, ['蛋白质', '蛋白摄入'], /蛋白/);
  const proteinScoops = numberFrom(lines, ['蛋白粉', '蛋白粉勺数'], /勺|scoop|蛋白粉/);
  const creatineG = numberFrom(lines, ['肌酸'], /肌酸/);
  const supplements: SummaryDraft['supplements'] = {
    proteinScoops,
    proteinG,
    creatineG,
    others: findLabelValue(lines, ['其他补剂', '补剂']) ?? undefined,
  };

  let confidence = 0;
  if (weightKg != null) confidence += 0.25;
  if (trainingContent) confidence += 0.3;
  if (trainingVolumeKg != null) confidence += 0.15;
  if (rpe != null) confidence += 0.15;
  if (sleepHours != null) confidence += 0.1;
  if (!trainingContent && weightKg == null) confidence = 0.1;

  if (!trainingContent) warnings.push('未识别到训练内容，请手动填写。');
  if (weightKg == null) warnings.push('未识别到体重，可手动填写或留空。');
  if (rpe == null) warnings.push('未识别到 RPE，可手动填写。');

  return {
    kind: 'daily-summary',
    importId: opts.importId,
    fileName: opts.fileName ?? '导入的总结.pdf',
    date,
    weightKg,
    trainingContent,
    trainingVolumeKg,
    rpe,
    sleepHours,
    diet,
    supplements,
    pain,
    feeling,
    fatigue,
    note,
    confidence: Math.min(1, confidence),
    warnings,
  };
}

/** 兜底：从文本里粗暴找「体重」类数字，用于身体报告 */
export function looseWeight(text: string): number | null {
  const m = normalizeText(text).match(/(\d{2,3}(?:\.\d+)?)\s*(kg|公斤|千克)/i);
  return m ? Number(m[1]) : null;
}
