/** 判断 PDF 属于哪一类（健身计划 / 今日总结 / 周计划 / 身体数据报告） */
import type { PdfKind } from '../../types';
import { normalizeText } from './text';

interface Rule {
  kind: PdfKind;
  weight: number;
  test: RegExp;
  /** true 表示只要命中就基本确定类型 */
  strong?: boolean;
}

const RULES: Rule[] = [
  // 强特征：标题里写明了类型
  { kind: 'weekly-plan', weight: 6, strong: true, test: /周(训练)?计划|本周训练|一周训练周?计划|训练周期安排/ },
  { kind: 'daily-summary', weight: 6, strong: true, test: /(?:^|\n)\s*(?:今日|每日|当天)?(?:训练)?(?:总结|复盘|日志)(?:\s*[（(].*[）)])?\s*(?=\n|$)|^\s*daily\s*summary\s*$/im },
  { kind: 'body-report', weight: 6, strong: true, test: /身体(数据|成分)报告|体测报告|体质报告|inbody|体脂率报告/i },
  { kind: 'plan', weight: 5, strong: true, test: /(训练|健身|今日|本周|力量|有氧)?(训练)?计划|训练安排|训练课表|课表/ },

  // 软特征：内容里出现的字段
  { kind: 'weekly-plan', weight: 1.5, test: /(周一|周二|周三|周四|周五|周六|周日)[^\n]{0,24}(训练|休息|力量|有氧|跑)/g },
  { kind: 'weekly-plan', weight: 1, test: /day\s*[1-7]\b/gi },

  { kind: 'daily-summary', weight: 1.2, test: /(感受|疲劳|睡眠|饮食|补剂|疼痛|不适)\s*[:：]/g },
  { kind: 'daily-summary', weight: 1.5, test: /训练量|训练容量|总容量|volume/i },
  { kind: 'daily-summary', weight: 1, test: /状态不错|感觉|复盘/g },

  { kind: 'body-report', weight: 1.5, test: /体脂(率)?\s*[:：]?\s*\d/i },
  { kind: 'body-report', weight: 1, test: /(骨骼肌|基础代谢|内脏脂肪|bmi)/gi },

  { kind: 'plan', weight: 1.4, test: /\d{1,2}\s*组\s*[x×*]\s*\d+|组数\s*[:：]|次数\s*[:：]|组间休息/g },
  { kind: 'plan', weight: 1.6, test: /\|\s*(动作|名称|项目)\s*\|/g },
  { kind: 'plan', weight: 1.2, test: /\|\s*(组数|次数|重量|休息)\s*\|/g },
  { kind: 'plan', weight: 1.2, test: /热身|拉伸|准备活动|冷身/g },
  { kind: 'plan', weight: 0.8, test: /rpe|rm\b|配速|心率/gi },
];

/** 只检查文档自身页首标题，不把文件名混入类型优先级。 */
export function hasPlanDocumentTitle(text: string): boolean {
  const firstLine = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine || firstLine.length > 42) return false;
  if (/分析|总结|复盘|报告/.test(firstLine)) return false;
  return /计划|课表|训练安排/.test(firstLine);
}

/** 文件标题或文档标题任一明确写“计划”时，视为计划强信号。 */
export function looksLikePlanDocumentTitle(text: string, fileName = ''): boolean {
  const name = normalizeText(fileName).replace(/[_-]+/g, ' ').trim();
  if (/计划|课表|训练安排/.test(name) && !/分析|总结|复盘|报告/.test(name)) return true;
  return hasPlanDocumentTitle(text);
}

export interface ClassifyResult {
  kind: PdfKind;
  scores: Record<PdfKind, number>;
  /** 0~1 */
  confidence: number;
}

export function classifyPdf(text: string, fileName = ''): ClassifyResult {
  const normalized = normalizeText(text);
  const hay = normalizeText(`${fileName}\n${text}`);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const head = lines.slice(0, 8).join('\n');
  const titleLead = `${fileName}\n${lines[0] ?? ''}`;
  const explicitPlanTitle = hasPlanDocumentTitle(normalized);
  const explicitPlanKind: PdfKind | null = explicitPlanTitle
    ? /周(?:训练)?计划|本周训练|一周训练/.test(lines[0] ?? '')
      ? 'weekly-plan'
      : 'plan'
    : null;
  const scores: Record<PdfKind, number> = {
    plan: 0,
    'daily-summary': 0,
    'weekly-plan': 0,
    'body-report': 0,
    unknown: 0,
  };
  let strongKind: PdfKind | null = null;

  for (const rule of RULES) {
    const re = new RegExp(rule.test.source, rule.test.flags.includes('g') ? 'gi' : 'i');
    // “训练总结”只有出现在页首独立标题时才作为强信号；正文中偶然提到不能覆盖计划。
    const source =
      rule.strong && (rule.kind === 'daily-summary' || rule.kind === 'plan')
        ? rule.kind === 'plan'
          ? titleLead
          : head
        : hay;
    const matches = source.match(re);
    if (matches?.length) {
      const times = rule.test.flags.includes('g') ? Math.min(matches.length, 3) : 1;
      scores[rule.kind] += rule.weight * times;
      if (rule.strong && !strongKind) strongKind = rule.kind;
    }
  }

  // 文件名是很强的信号
  const name = normalizeText(fileName).toLowerCase();
  if (/周计划|weekly/.test(name)) scores['weekly-plan'] += 4;
  if (/总结|summary|复盘/.test(name)) scores['daily-summary'] += 4;
  if (/体测|身体|body|inbody/.test(name)) scores['body-report'] += 4;
  if (/计划|plan|program/.test(name)) scores.plan += 3;

  const entries = (Object.keys(scores) as PdfKind[]).filter((k) => k !== 'unknown');
  const bestByScore = entries.reduce((a, b) => (scores[b] > scores[a] ? b : a), 'unknown' as PdfKind);
  const total = entries.reduce((sum, k) => sum + scores[k], 0);

  // 命中强特征时以强特征为准（标题优先级：周计划 > 总结 > 身体报告 > 计划）
  const kind = explicitPlanKind ?? strongKind ?? bestByScore;
  if (kind === 'unknown' || (scores[kind] < 2 && !strongKind)) {
    return { kind: 'unknown', scores, confidence: 0 };
  }
  return {
    kind,
    scores,
    confidence:
      explicitPlanKind != null
        ? Math.max(0.9, total > 0 ? scores[kind] / total + 0.2 : 0.9)
        : total > 0
          ? Math.min(1, Math.max(0.45, scores[kind] / total + 0.2))
          : 0.4,
  };
}
