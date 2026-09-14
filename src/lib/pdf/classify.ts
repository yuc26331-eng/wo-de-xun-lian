/** 判断 PDF 属于哪一类（健身计划 / 今日总结 / 周计划 / 身体数据报告） */
import type { PdfKind } from '../../types';
import { normalizeText } from './text';

interface Rule {
  kind: PdfKind;
  weight: number;
  test: RegExp;
}

const RULES: Rule[] = [
  // 周训练计划
  { kind: 'weekly-plan', weight: 3, test: /周训练计划|本周训练|一周训练|训练周计划|周计划/ },
  { kind: 'weekly-plan', weight: 1, test: /(周一|周二|周三|周四|周五|周六|周日)[^\n]{0,20}(训练|休息|力量|有氧)/g },
  { kind: 'weekly-plan', weight: 1, test: /day\s*[1-7]\b/gi },

  // 今日总结
  { kind: 'daily-summary', weight: 3, test: /今日(训练)?总结|训练总结|今日复盘|训练日志|daily\s*summary/i },
  { kind: 'daily-summary', weight: 2, test: /(今日)?(感受|状态|疲劳|睡眠|饮食|补剂|疼痛|不适)[:：]/g },
  { kind: 'daily-summary', weight: 2, test: /训练量|训练容量|总容量|volume/i },

  // 身体数据报告
  { kind: 'body-report', weight: 3, test: /身体数据|体测|inbody|体质报告|身体成分|体脂率报告/i },
  { kind: 'body-report', weight: 2, test: /体脂(率)?[:：]?\s*\d/i },
  { kind: 'body-report', weight: 1, test: /(体重|骨骼肌|基础代谢|内脏脂肪|bmi)/gi },

  // 健身计划
  { kind: 'plan', weight: 3, test: /训练计划|健身计划|今日训练|训练安排|训练课表/ },
  { kind: 'plan', weight: 2, test: /\d+\s*组\s*[x×*]\s*\d+|组数[:：]|次数[:：]|组间休息/ },
  { kind: 'plan', weight: 2, test: /热身|拉伸|准备活动/ },
  { kind: 'plan', weight: 1, test: /rpe|rm\b|配速|心率/i },
];

export interface ClassifyResult {
  kind: PdfKind;
  scores: Record<PdfKind, number>;
  /** 0~1 */
  confidence: number;
}

export function classifyPdf(text: string, fileName = ''): ClassifyResult {
  const hay = normalizeText(`${fileName}\n${text}`);
  const scores: Record<PdfKind, number> = {
    plan: 0,
    'daily-summary': 0,
    'weekly-plan': 0,
    'body-report': 0,
    unknown: 0,
  };

  for (const rule of RULES) {
    const re = new RegExp(rule.test.source, rule.test.flags.includes('g') ? 'gi' : 'i');
    const matches = hay.match(re);
    if (matches?.length) {
      const times = rule.test.flags.includes('g') ? Math.min(matches.length, 3) : 1;
      scores[rule.kind] += rule.weight * times;
    }
  }

  // 文件名是很强的信号
  const name = normalizeText(fileName).toLowerCase();
  if (/周计划|weekly/.test(name)) scores['weekly-plan'] += 4;
  if (/总结|summary|复盘/.test(name)) scores['daily-summary'] += 4;
  if (/体测|身体|body|inbody/.test(name)) scores['body-report'] += 4;
  if (/计划|plan|program/.test(name)) scores.plan += 3;

  const entries = (Object.keys(scores) as PdfKind[]).filter((k) => k !== 'unknown');
  const best = entries.reduce((a, b) => (scores[b] > scores[a] ? b : a), 'unknown' as PdfKind);
  const bestScore = scores[best];
  const total = entries.reduce((sum, k) => sum + scores[k], 0);

  if (bestScore < 2) return { kind: 'unknown', scores, confidence: 0 };
  return { kind: best, scores, confidence: total > 0 ? Math.min(1, bestScore / total + 0.15) : 0 };
}
