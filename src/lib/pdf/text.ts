/**
 * PDF 文字解析的底层工具（纯函数，无 DOM 依赖）
 *
 * 目标：把 ChatGPT 导出的 PDF 文本（可能是 Markdown、表格、逐行字段）
 * 归一化成「易于用正则抽取」的形式，同时保留原始语义。
 */

/** 全角 -> 半角（数字、字母、常见标点），便于统一写正则 */
const FULLWIDTH_MAP: Record<string, string> = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e',
  '．': '.', '％': '%', '（': '(', '）': ')', '［': '[', '］': ']',
  'ｘ': 'x', 'Ｘ': 'X', '∶': ':', '：': ':', '，': ',',
  '；': ';', '！': '!', '？': '?', '、': ',', '～': '~',
  '／': '/', '＋': '+', '－': '-', '＝': '=', '＠': '@',
  '　': ' ',
};

export function normalizeText(input: string): string {
  let out = '';
  for (const ch of input) out += FULLWIDTH_MAP[ch] ?? ch;
  return out
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n');
}

/** 逐行清洗：去空白、去页码、去页眉页脚噪声 */
export function cleanLines(input: string): string[] {
  const lines = normalizeText(input)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s|]+|[\s|]+$/g, '').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^第?\s*\d+\s*页(\s*[/·]\s*共?\s*\d+\s*页)?$/.test(l))
    .filter((l) => !/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(l))
    .filter((l) => !/^[-—－_\s]+$/.test(l));
  return lines;
}

export function hasCJK(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** 相邻两段文字之间是否需要补空格（中文之间不补，英文/数字之间补） */
export function needsSpace(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  const a = prev[prev.length - 1];
  const b = next[0];
  if (CJK_CHAR.test(a) || CJK_CHAR.test(b)) return false;
  if (/[\s(（[/]/.test(a)) return false;
  if (/[\s)）\]},.,;:!?、。，；：！？]/.test(b)) return false;
  return true;
}

/** 从一段文字里取数字（支持 8-12 取 8 / 90.5 / 1,200） */
export function firstNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 如 '1分30秒' / '90秒' / '2分钟' / '1:30' / '90s' -> 秒 */
export function parseDurationSec(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = normalizeText(text);
  const mmss = t.match(/(\d{1,3})\s*[:：分]\s*(\d{1,2})\s*秒?/);
  if (mmss && /[:：]/.test(t)) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const minSec = t.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min|m)\s*(?:(\d{1,2})\s*秒)?/i);
  if (minSec) {
    const min = Number(minSec[1]);
    const sec = minSec[2] ? Number(minSec[2]) : 0;
    return Math.round(min * 60 + sec);
  }
  const secOnly = t.match(/(\d+(?:\.\d+)?)\s*(?:秒|s\b|sec)/i);
  if (secOnly) return Math.round(Number(secOnly[1]));
  const hour = t.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b|hr)/i);
  if (hour) return Math.round(Number(hour[1]) * 3600);
  return null;
}

/** 'YYYY-MM-DD'；识别 2026年9月15日 / 2026-09-15 / 09/15/2026 / 9月15日(补当前年) */
export function parseDateLoose(
  text: string,
  fallbackYear?: number,
): string | null {
  const year = fallbackYear ?? new Date().getFullYear();
  const t = normalizeText(text);
  let m = t.match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return iso(year, Number(m[1]), Number(m[2]));
  m = t.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${`${m}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`;
}

export interface LabelHit {
  value: string;
  label: string;
}

/** 在一行里找 '标签: 值' 结构，支持中英文冒号与多种标签写法 */
export function matchLabel(line: string, labels: string[]): LabelHit | null {
  const t = normalizeText(line).replace(/^[-*•·\d.、)）\s]+/, '');
  for (const label of labels) {
    const re = new RegExp(
      `(?:^|[|\\s,])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[:：=]|为|是)\\s*([^|,，;；]{1,120})`,
    );
    const m = t.match(re);
    if (m && m[1].trim()) return { value: m[1].trim(), label };
  }
  return null;
}

/** 去掉 '1. '、'①'、'- '、'* ' 等序号/项目符号 */
export function stripBullet(line: string): { text: string; index: number | null } {
  const t = normalizeText(line);
  const num = t.match(/^\(?(\d{1,2})\)?\s*[.、)）:：]?\s+(?=\S)/);
  if (num) return { text: t.slice(num[0].length).trim(), index: Number(num[1]) };
  const circled = t.match(/^([①-⑳])\s*/);
  if (circled) {
    const code = circled[1].charCodeAt(0);
    const n = code >= 0x2460 ? code - 0x2460 + 1 : null;
    return { text: t.slice(circled[0].length).trim(), index: n };
  }
  const bullet = t.match(/^[-*•·]\s+/);
  if (bullet) return { text: t.slice(bullet[0].length).trim(), index: null };
  // '1、深蹲' / '1）深蹲' 这类没有空格的写法
  const num2 = t.match(/^(\d{1,2})\s*[、)）]\s*(?=\S)/);
  if (num2) return { text: t.slice(num2[0].length).trim(), index: Number(num2[1]) };
  return { text: t.trim(), index: null };
}

/** 判断一行是否像小节标题（短、无数字组次信息） */
export function isHeading(line: string, keywords: string[]): boolean {
  const t = normalizeText(line).replace(/^[#*\s]+/, '').replace(/[:：]\s*$/, '').trim();
  if (t.length === 0 || t.length > 16) return false;
  if (/\d+\s*(组|次|kg|公斤)/.test(t)) return false;
  return keywords.some((k) => t.includes(k));
}

/** 把 markdown 表格行拆成单元格 */
export function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  if (cells.length < 2) return null;
  if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return null; // 分隔行
  return cells;
}

/** 文本里是否包含「无法解析」的扫描件特征 */
export function looksScanned(text: string, pageCount: number): boolean {
  const solid = text.replace(/\s/g, '');
  if (pageCount <= 0) return true;
  if (solid.length < Math.max(20, pageCount * 12)) return true;
  return false;
}
