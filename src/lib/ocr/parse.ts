// 截图文字 → 结构化数据
//
// 针对 Apple「健身」摘要 / 活动详情 / 体能训练详情 / 「健康」睡眠（日视图）做了专门适配：
// - 只认「标签 +（同一行或紧邻的下一行）数值」的组合，绝不全文乱抓最大值
// - 目标值（1,232/2,000 千卡）只取斜杠前面的实际值，目标单独记下来供核对
// - 时钟、图表坐标、状态栏时间、周/月视图、站立小时等不会被当成睡眠时长
// - 判断不了就留空（status=empty）或标记「待确认」，不编造数值
import type { SleepData, WatchData } from '../../types';

// 截图类型：睡眠 / 全天活动 / 单次训练 / 无法判断
export type ScreenshotKind = 'sleep' | 'activity' | 'workout' | 'unknown';

export const SCREENSHOT_KIND_LABEL: Record<ScreenshotKind, string> = {
  sleep: '睡眠截图',
  activity: '全天活动截图',
  workout: '单次训练截图',
  unknown: '无法判断类型',
};

export interface OcrField<T = number> {
  value: T;
  // 命中的原文片段，便于用户核对
  evidence: string;
  // 该字段来自哪张截图
  source: number;
  // OCR 有歧义，需要用户确认后再使用
  pending?: boolean;
  // 截图里的目标值（例如 1,232/2,000 千卡里的 2,000）
  goal?: number;
}

export type WatchFieldKey = keyof WatchData;

// 单次训练专用字段（来自「体能训练详细信息」截图）
export type WorkoutFieldKey =
  | 'durationMin'
  | 'distanceKm'
  | 'kcal'
  | 'totalKcal'
  | 'avgHr'
  | 'maxHr'
  | 'startTime';

export interface WatchAnalysis {
  kind: ScreenshotKind;
  text: string;
  // 全天活动数据（摘要 / 活动详情）
  fields: Partial<Record<WatchFieldKey, OcrField<number>>>;
  // 单次训练截图的字段
  workoutFields: Partial<Record<WorkoutFieldKey, OcrField<number | string>>>;
  hints: string[];
  warnings: string[];
  // ok=有有效数据；partial=有歧义需确认；empty=没提取到
  status: 'ok' | 'partial' | 'empty';
  pendingFields: string[];
}

export interface SleepAnalysis {
  kind: ScreenshotKind;
  text: string;
  sleep: Partial<SleepData>;
  pendingFields: string[];
  hints: string[];
  warnings: string[];
  status: 'ok' | 'partial' | 'empty';
}

// ----------------------------- 文本预处理 -----------------------------

const FULLWIDTH = '０１２３４５６７８９：．，／（）';
const HALFWIDTH = '0123456789:.,/()';

// OCR 常见错字（中文单位）
const OCR_FIXES: [RegExp, string][] = [
  [/[干甘]卡/g, '千卡'],
  [/干\s*卡/g, '千卡'],
  [/必\s*球/g, '足球'],
  [/睡\s*上\s*中/g, '睡眠'],
  [/\bFRE\b/gi, '静息'],
];

export function normalizeOcrText(input: string): string {
  let out = input ?? '';
  for (let i = 0; i < FULLWIDTH.length; i += 1) {
    out = out.split(FULLWIDTH[i]).join(HALFWIDTH[i]);
  }
  out = out
    .replace(/[|｜]/g, ' ')
    // OCR 常在汉字之间插入空格（"活 动 能 量"），去掉后才好匹配标签
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
    // 数字与中文单位之间保留一个空格
    .replace(/(\d)[ \t]+(?=[\u4e00-\u9fff])/g, '$1 ')
    .replace(/[ \t]*\/[ \t]*/g, '/')
    .replace(/(\d)[ \t]*'[ \t]*(?=\d{3}\b)/g, '$1,');
  for (const [re, to] of OCR_FIXES) out = out.replace(re, to);
  return out
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

// 数字模式：整数（允许逗号/全角空格做千分位）+ 可选小数。
// 关键：不把普通空格当千分位，否则 "0:59:49 415 千卡" 会粘成 "49 415 千卡"，
// "14,332 11.86 公里" 会粘成 "14.33211"。
const NUM_RE_SOURCE = "\\d+(?:[,'\\u3000]\\d{3})*(?:\\.\\d+)?";

// 把 "1,232" / "1 232" 这类千分位写成纯数字；小数保留
export function parseLooseNumber(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();
  // 只在"分隔符后面正好 3 位数字"时当成千分位（普通空格同样只在千分位位置才吃掉）
  s = s.replace(/(\d)[,\u3000 ](?=\d{3}(\D|$))/g, '$1');
  s = s.replace(/,/g, '.');
  s = s.replace(/\u3000/g, '');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// 一行的所有数字（已处理千分位）
export function numbersIn(line: string): number[] {
  return (line.match(new RegExp(NUM_RE_SOURCE, 'g')) ?? [])
    .map((s) => parseLooseNumber(s))
    .filter((n): n is number => n != null);
}

// "1,232/2,000 千卡" → 实际值 1232，目标 2000
export function splitActualGoal(line: string): { actual: number | null; goal: number | null } {
  const m = new RegExp(`(${NUM_RE_SOURCE})\\s*\\/\\s*(${NUM_RE_SOURCE})`).exec(line);
  if (!m) return { actual: null, goal: null };
  return { actual: parseLooseNumber(m[1]), goal: parseLooseNumber(m[2]) };
}

// ---------------------------- 类型判断 ----------------------------

const SLEEP_WORDS =
  /睡眠|快速动眼|异相睡眠|核心睡眠|深度睡眠|清醒时间|就寝|入睡|\bsleep\b|\brem\b|\bawake\b/i;
const WORKOUT_WORDS =
  /体能训练详细|体能训练时间|动态千卡|总千卡数|workout\s*detail|total\s*energy|average\s*heart/i;
const ACTIVITY_WORDS =
  /健身圆环|活动能量|锻炼|站立|步数|步行距离|活动|active\s*energy|exercise\b|stand\b|steps?\b/i;

// 判断截图类型（用于把数据放到正确的步骤与训练卡片里）
export function classifyHealthText(rawText: string): ScreenshotKind {
  const text = normalizeOcrText(rawText);
  const hasSleep = SLEEP_WORDS.test(text);
  const hasWorkout = WORKOUT_WORDS.test(text);
  const hasActivity = ACTIVITY_WORDS.test(text);
  // 睡眠截图里也可能出现"锻炼"（摘要里同时有睡眠卡片），优先判睡眠
  if (hasSleep && !hasWorkout) return 'sleep';
  if (hasWorkout) return 'workout';
  if (hasActivity) return 'activity';
  return 'unknown';
}

// ------------------------- 标签/数值配对工具 -------------------------

interface LineValue {
  value: number;
  goal: number | null;
  evidence: string;
  nextLine: boolean;
  // OCR 把斜杠/冒号吃掉后靠规则修出来的值，需要用户确认
  repaired?: boolean;
}

const hasLabel = (line: string, labels: RegExp[]): boolean => labels.some((re) => re.test(line));

function valueFromLine(line: string, unitRe?: RegExp): LineValue | null {
  const pair = splitActualGoal(line);
  if (pair.actual != null && (!unitRe || unitRe.test(line))) {
    return { value: pair.actual, goal: pair.goal, evidence: line, nextLine: false };
  }
  if (unitRe) {
    const m = new RegExp(`(${NUM_RE_SOURCE})\\s*(?:${unitRe.source})`, 'i').exec(line);
    if (m) {
      const v = parseLooseNumber(m[1]);
      if (v != null) return { value: v, goal: pair.goal, evidence: line, nextLine: false };
    }
    const m2 = new RegExp(`(?:${unitRe.source})\\s*[:：]?\\s*(${NUM_RE_SOURCE})`, 'i').exec(line);
    if (m2) {
      const v = parseLooseNumber(m2[1]);
      if (v != null) return { value: v, goal: pair.goal, evidence: line, nextLine: false };
    }
    return null;
  }
  const nums = numbersIn(line);
  if (!nums.length) return null;
  return { value: pair.actual ?? nums[0], goal: pair.goal, evidence: line, nextLine: false };
}

// 一行里出现这些词，说明它属于别的指标
const METRIC_LABEL_RE =
  /活动|锻炼|站立|步数|距离|心率|睡眠|快速动眼|核心睡眠|深度睡眠|清醒|楼层|奖章|训练|耗能|血氧|呼吸/;

// 不该被当成当日数值的目标 / 平均值 / 周期字样
const NOT_DAILY_RE = /目标|未站立|本周|上周|平均|上月|总计/;

// 找「标签行 → 数值行」：先看同一行，再看后面最多 2 行（Apple 健康常把数值放下一行）
function lookup(
  lines: string[],
  index: number,
  unitRe: RegExp | undefined,
  opts: { min: number; max: number; reject?: RegExp; allowNextLines?: number },
): LineValue | null {
  const allow = opts.allowNextLines ?? 2;
  const candidates: string[] = [lines[index]];
  for (let k = 1; k <= allow; k += 1) {
    const next = lines[index + k];
    if (!next) break;
    if (METRIC_LABEL_RE.test(next) && !(unitRe?.test(next) ?? false)) break;
    candidates.push(next);
  }
  for (const line of candidates) {
    if (opts.reject && opts.reject.test(line)) continue;
    const got = valueFromLine(line, unitRe);
    if (!got) continue;
    if (got.value < opts.min || got.value > opts.max) continue;
    return { ...got, nextLine: line !== lines[index] };
  }
  // 兜底修复：OCR 常把单位读成乱码（"千卡"→FF、"分钟"→54），
  // 但「实际值/目标值」这种结构仍然可辨（2,575/2,000）。只有两端都在合理范围内才采用，
  // 并标记为「待确认」，让用户核对后再保存。
  for (const line of candidates) {
    if (opts.reject && opts.reject.test(line)) continue;
    const pair = splitActualGoal(line);
    if (pair.actual != null && pair.goal != null) {
      const goalOk = pair.goal >= opts.min && pair.goal <= opts.max;
      if (pair.actual >= opts.min && pair.actual <= opts.max && goalOk) {
        return { value: pair.actual, goal: pair.goal, evidence: line, nextLine: false, repaired: true };
      }
    }
    const ff = new RegExp(`(${NUM_RE_SOURCE})\\s*ff`, 'i').exec(line);
    if (ff) {
      const v = parseLooseNumber(ff[1]);
      if (v != null && v >= opts.min && v <= opts.max) {
        return { value: v, goal: null, evidence: line, nextLine: false, repaired: true };
      }
    }
  }
  return null;
}

// ----------------------- 全天活动（摘要/圆环） -----------------------

interface MetricSpec {
  key: WatchFieldKey;
  labels: RegExp[];
  units: RegExp[];
  min: number;
  max: number;
}

export const ACTIVITY_METRICS: MetricSpec[] = [
  {
    key: 'activeEnergyKcal',
    labels: [/^活动$/, /活动能量/, /^活动/, /active\s*energy/i],
    units: [/千卡/, /大卡/, /kcal/i, /卡路里/],
    min: 20,
    max: 8000,
  },
  {
    key: 'totalEnergyKcal',
    labels: [/^共/, /总千卡数/, /总消耗/, /总能量/, /total\s*energy/i, /总卡路里/],
    units: [/千卡/, /大卡/, /kcal/i, /卡路里/i],
    min: 50,
    max: 12000,
  },
  {
    key: 'exerciseMinutes',
    labels: [/^锻炼$/, /锻炼/, /运动时间/, /运动分钟/, /exercise/i],
    units: [/分钟/, /min/i],
    min: 1,
    max: 1440,
  },
  {
    key: 'standHours',
    labels: [/^站立$/, /站立/, /stand/i],
    units: [/小时/, /hrs?\b/i],
    min: 1,
    max: 24,
  },
  {
    key: 'steps',
    labels: [/^步数$/, /步数/, /steps?/i],
    units: [/步/, /steps?/i],
    min: 10,
    max: 200000,
  },
  {
    key: 'distanceKm',
    labels: [/步行距离/, /^距离$/, /距离/, /distance/i],
    // "公里" 有时会被读成 AE（Apple 健康里常见）
    units: [/公里/, /千米/, /km/i, /^AE$/i, /\bAE\b/],
    min: 0.1,
    max: 200,
  },
  {
    key: 'avgHr',
    // "平均心率" 也可能被拆成单独一行"平均"（Apple 健康常见排版）
    labels: [/平均心率/, /^平均$/, /average\s*heart/i, /avg\b/i],
    units: [/次\/分/, /bpm/i],
    min: 30,
    max: 220,
  },
  {
    key: 'maxHr',
    labels: [/最高心率/, /最大心率/, /^最高$/, /max\b/i],
    units: [/次\/分/, /bpm/i],
    min: 30,
    max: 230,
  },
  {
    key: 'restingHr',
    labels: [/静息心率/, /^静息$/, /resting/i],
    units: [/次\/分/, /bpm/i],
    min: 25,
    max: 150,
  },
  {
    key: 'hrvMs',
    labels: [/HRV/i, /心率变异性/],
    units: [/毫秒/, /ms\b/i],
    min: 1,
    max: 400,
  },
  {
    key: 'bloodOxygenPct',
    labels: [/血氧/, /blood\s*oxygen/i, /spo2/i],
    units: [/%/],
    min: 60,
    max: 100,
  },
];

/** 把同一指标的多个单位写法合并成一个正则（例如 千卡|大卡|kcal） */
const unitPattern = (spec: MetricSpec): RegExp =>
  new RegExp(spec.units.map((u) => u.source).join('|'), 'i');

const UNIT_CACHE = new Map<WatchFieldKey, RegExp>();
const unitsOf = (spec: MetricSpec): RegExp => {
  const hit = UNIT_CACHE.get(spec.key);
  if (hit) return hit;
  const re = unitPattern(spec);
  UNIT_CACHE.set(spec.key, re);
  return re;
};

// 「站立 16/8 小时」：取斜杠前。
// OCR 有时会把 "16/8 小时" 读成 "1618 4 时"（斜杠当成 1、"小时"当成"4 时"）：
// 这种情况按"前两位=实际、最后一位=目标"还原，并交给用户确认；
// 实在无法判断时宁可不填（返回 null），也不猜一个数。
function standHoursValue(line: string): LineValue | null {
  const pair = splitActualGoal(line);
  if (pair.actual != null && /小时|hrs?\b/i.test(line)) {
    return { value: pair.actual, goal: pair.goal, evidence: line, nextLine: false };
  }
  const four = /(\d{4})\s*\d?\s*(?:小时|时|hrs?\b)/i.exec(line);
  if (four) {
    const digits = four[1];
    const actual = Number(digits.slice(0, 2));
    const goalWide = Number(digits.slice(2));
    const goalNarrow = Number(digits.slice(3));
    const goal = goalWide >= 1 && goalWide <= 12 ? goalWide : goalNarrow;
    if (actual >= 1 && actual <= 24 && goal >= 1 && goal <= 12) {
      return { value: actual, goal, evidence: line, nextLine: false, repaired: true };
    }
    return null;
  }
  // 兜底：只有一个数字时才算"实际小时数"，且该行不能还有其它数字（否则可能是被吃掉的斜杠）
  const digitGroups = line.match(/\d+/g) ?? [];
  if (digitGroups.length > 1) return null;
  const hours = /(\d{1,2})\s*(?:小时|时|hrs?\b)/i.exec(line);
  if (hours) {
    const actual = Number(hours[1]);
    if (actual >= 1 && actual <= 24) {
      return { value: actual, goal: null, evidence: line, nextLine: false };
    }
  }
  return null;
}

// 「步数 步行距离 / 今天 今天 / 14,332 11.86 公里」这类合并卡片：
// 步数是没有单位、没有小数的整数，距离一定带 公里/km。
function stepsFromMerged(
  lines: string[],
  index: number,
): { steps: number | null; evidence: string } {
  for (let k = 0; k <= 2; k += 1) {
    const line = lines[index + k];
    if (!line) break;
    if (k > 0 && /[站锻活步距]/.test(line) && !/\d/.test(line)) break;
    const tokens = line.match(new RegExp(NUM_RE_SOURCE, 'g')) ?? [];
    for (const token of tokens) {
      const tokenIdx = line.indexOf(token);
      const unitIdx = line.search(/公里|千米|km/i);
      // 距离单位出现在数字后面时，这个数字属于距离，不是步数
      if (token.includes('.') || (unitIdx >= 0 && tokenIdx > unitIdx)) continue;
      const v = parseLooseNumber(token);
      if (v != null && Number.isInteger(v) && v >= 10 && v <= 200000) {
        return { steps: v, evidence: line };
      }
    }
  }
  return { steps: null, evidence: '' };
}

// 解析全天活动截图（健身圆环 / 摘要 / 活动详情）
export function parseActivityText(rawText: string): WatchAnalysis {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n');
  const fields: WatchAnalysis['fields'] = {};
  const hints: string[] = [];
  const warnings: string[] = [];
  const pendingFields: string[] = [];

  const assign = (key: WatchFieldKey, got: LineValue, label: string, forcePending = false) => {
    if (fields[key]) return;
    // 明确写了 "实际/目标" 的字段不算待确认；只有 OCR 修复过的排版才需要用户核对
    const pending = forcePending || Boolean(got.repaired);
    fields[key] = {
      value: got.value,
      evidence: got.evidence,
      source: 0,
      pending: pending || undefined,
      goal: got.goal ?? undefined,
    };
    if (pending) pendingFields.push(label);
  };

  lines.forEach((line, index) => {
    if (/站立|stand/i.test(line) && !fields.standHours) {
      const same = standHoursValue(line);
      const next = same ?? (lines[index + 1] ? standHoursValue(lines[index + 1]) : null);
      if (next && next.value >= 1 && next.value <= 24) {
        assign('standHours', next, '站立小时', /未站立/.test(line));
      }
      return;
    }
    for (const spec of ACTIVITY_METRICS) {
      if (fields[spec.key] || spec.key === 'standHours') continue;
      if (!hasLabel(line, spec.labels)) continue;
      const got = lookup(lines, index, unitsOf(spec), {
        min: spec.min,
        max: spec.max,
        reject: NOT_DAILY_RE,
        allowNextLines: 2,
      });
      if (got) assign(spec.key, got, spec.key);
    }
  });

  // 合并卡片（"步数 步行距离" 挤在一行、数值在下面两行）：
  // 步数是没有小数、没有单位的整数
  if (!fields.steps) {
    const idx = lines.findIndex((l) => /^步数|步数/.test(l));
    if (idx >= 0) {
      const got = stepsFromMerged(lines, idx);
      if (got.steps != null) {
        fields.steps = {
          value: got.steps,
          evidence: got.evidence,
          source: 0,
          pending: true, // 排版被合并过，标记待确认更稳妥
        };
        pendingFields.push('步数');
      }
    }
  }

  // 「共 5,629 千卡」= 全天总消耗（活动详情页）
  if (!fields.totalEnergyKcal) {
    const idx = lines.findIndex((l) => /^共\s*[\d,]+/.test(l) && /千卡|kcal/i.test(l));
    if (idx >= 0) {
      const got = valueFromLine(lines[idx], /千卡|kcal/i);
      if (got && got.value >= 50 && got.value <= 12000) {
        fields.totalEnergyKcal = { value: got.value, evidence: lines[idx], source: 0 };
      }
    }
  }

  const found = Object.keys(fields).length;
  if (found === 0) {
    warnings.push(
      '没提取到全天活动数据：请上传「健身」摘要页或活动详情页截图（能看到活动能量 / 锻炼 / 站立 / 步数）',
    );
  } else {
    hints.push(`全天活动：识别到 ${found} 项，填的是截图里的实际值（目标值不会导入）`);
  }
  if (fields.activeEnergyKcal?.goal != null) {
    hints.push(
      `活动能量取实际值 ${fields.activeEnergyKcal.value} 千卡；截图里的目标 ${fields.activeEnergyKcal.goal} 千卡没有导入`,
    );
  }
  const pendingOnly = pendingFields.length > 0;
  return {
    kind: 'activity',
    text,
    fields,
    workoutFields: {},
    hints,
    warnings,
    status: found === 0 ? 'empty' : pendingOnly ? 'partial' : 'ok',
    pendingFields,
  };
}

// ------------------------ 单次训练（体能训练详情） ------------------------

export const WORKOUT_FIELD_LABEL: Record<WorkoutFieldKey, string> = {
  durationMin: '训练时长',
  distanceKm: '距离',
  kcal: '动态消耗',
  totalKcal: '总消耗',
  avgHr: '平均心率',
  maxHr: '最高心率',
  startTime: '开始时间',
};

// "1:42:12" / "142:12"（OCR 丢冒号）/ "0:59:49" / "59:49" → 分钟
export function parseDurationToMinutes(
  raw: string,
): { minutes: number; suspicious: boolean } | null {
  const t = raw.trim().replace(/\s+/g, '');
  let m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    if (min < 60 && s < 60) {
      return { minutes: Math.round((h * 60 + min + s / 60) * 10) / 10, suspicious: false };
    }
  }
  m = /^(\d{3,4}):(\d{2})$/.exec(t);
  if (m) {
    const digits = m[1];
    const h = Number(digits.slice(0, digits.length - 2));
    const min = Number(digits.slice(-2));
    const s = Number(m[2]);
    if (h <= 12 && min < 60 && s < 60) {
      return { minutes: Math.round((h * 60 + min + s / 60) * 10) / 10, suspicious: true };
    }
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (min < 60) {
      // "1:30" = 1 小时 30 分；"45:00" 这种大于 12 的按 分:秒 处理（45 分钟）
      const minutes = h <= 12 ? h * 60 + min : h + min / 60;
      return { minutes: Math.round(minutes * 10) / 10, suspicious: true };
    }
  }
  return null;
}

// 解析单次训练截图（体能训练详细信息）
export function parseWorkoutText(rawText: string): WatchAnalysis {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n');
  const workoutFields: WatchAnalysis['workoutFields'] = {};
  const hints: string[] = [];
  const warnings: string[] = [];
  const pendingFields: string[] = [];

  const setField = (
    key: WorkoutFieldKey,
    value: number | string,
    evidence: string,
    pending = false,
  ) => {
    if (workoutFields[key]) return;
    workoutFields[key] = { value, evidence, source: 0, pending: pending || undefined };
    if (pending) pendingFields.push(WORKOUT_FIELD_LABEL[key]);
  };

  // 1) 训练时间范围：09:33-10:32 / 16:32-18:14
  const range = /(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (range) {
    const h = Number(range[1]);
    const m = Number(range[2]);
    if (h <= 23 && m <= 59) {
      setField('startTime', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, range[0]);
    }
  }

  // 2) 体能训练时间 → 时长
  const durIdx = lines.findIndex((l) => /体能训练时间/.test(l));
  if (durIdx >= 0) {
    const candidates = [lines[durIdx], lines[durIdx + 1] ?? '', lines[durIdx + 2] ?? ''];
    for (const c of candidates) {
      const m = /(\d{1,4}:\d{2}(?::\d{2})?)/.exec(c);
      if (!m) continue;
      const parsed = parseDurationToMinutes(m[1]);
      if (parsed && parsed.minutes >= 1 && parsed.minutes <= 600) {
        setField('durationMin', parsed.minutes, c, parsed.suspicious);
        break;
      }
    }
  }

  const metric = (
    key: WorkoutFieldKey,
    labelRe: RegExp,
    unitRe: RegExp,
    min: number,
    max: number,
    reject?: RegExp,
  ) => {
    if (workoutFields[key]) return;
    const idx = lines.findIndex((l) => labelRe.test(l));
    if (idx < 0) return;
    const got = lookup(lines, idx, unitRe, { min, max, reject });
    if (got) setField(key, got.value, got.evidence, false);
  };

  metric('kcal', /动态千卡/, /千卡|kcal/i, 5, 5000);
  metric('totalKcal', /总千卡数/, /千卡|kcal/i, 5, 8000);
  metric('distanceKm', /距离/, /公里|千米|km/i, 0.05, 200);
  metric('avgHr', /平均心率|平均\s*\d{2,3}\s*次/, /次\/分|bpm/i, 30, 220);
  metric('maxHr', /最高心率|最大心率/, /次\/分|bpm/i, 30, 230);

  // Apple 的体能训练详情页把「动态 千卡 / 总 千卡 数」两个标签挤在同一行，
  // 数值行则是 "415 千卡 593 千卡"：按出现顺序，第一个是动态、第二个是总消耗。
  const kcalMatches = [
    ...text.matchAll(new RegExp(`(${NUM_RE_SOURCE})\\s*(?:千卡|kcal|ff)`, 'gi')),
  ];
  const kcalValues = kcalMatches
    .map((m) => ({
      value: parseLooseNumber(m[1]),
      evidence: m[0],
      mangled: /ff/i.test(m[0]),
    }))
    .filter(
      (x): x is { value: number; evidence: string; mangled: boolean } =>
        x.value != null && x.value >= 5 && x.value <= 8000,
    );
  // 顺序扫描的结果最可靠：第一个「千卡」是动态消耗，第二个是总消耗。
  if (kcalValues[0]) {
    workoutFields.kcal = {
      value: kcalValues[0].value,
      evidence: kcalValues[0].evidence,
      source: 0,
      pending: kcalValues[0].mangled || undefined,
    };
    if (kcalValues[0].mangled) pendingFields.push('动态消耗');
  }
  if (kcalValues[1]) {
    workoutFields.totalKcal = {
      value: kcalValues[1].value,
      evidence: kcalValues[1].evidence,
      source: 0,
      pending: kcalValues[1].mangled || undefined,
    };
    if (kcalValues[1].mangled) pendingFields.push('总消耗');
  }
  // 心率：只认带「次/分」的数字，图表上的孤立数字（132/186/89）不算
  if (!workoutFields.avgHr) {
    const hr = new RegExp(`(${NUM_RE_SOURCE})\\s*次\\s*/\\s*分`).exec(text);
    const v = hr ? parseLooseNumber(hr[1]) : null;
    if (v != null && v >= 30 && v <= 220) setField('avgHr', v, hr![0]);
  }

  const found = Object.keys(workoutFields).length;
  if (found === 0) {
    warnings.push(
      '没提取到训练数据：请上传「体能训练详细信息」截图（能看到体能训练时间 / 动态千卡 / 心率）',
    );
  } else {
    hints.push(`单次训练：识别到 ${found} 项，已填入这张训练卡片`);
  }
  return {
    kind: 'workout',
    text,
    fields: {},
    workoutFields,
    hints,
    warnings,
    status: found === 0 ? 'empty' : pendingFields.length ? 'partial' : 'ok',
    pendingFields,
  };
}

// ------------------------------ 睡眠解析 ------------------------------

// 5.02 → "5小时1分钟"
export function sleepDurationText(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}分钟`;
  return m === 0 ? `${h}小时` : `${h}小时${m}分钟`;
}

// "5小时1分钟" / "5 小时 1 分" / "1小时07分" → 小时数
export function parseDurationHours(line: string): number | null {
  const hm = /(\d{1,2})\s*(?:小时|时|h|hrs?)\s*(\d{1,2})\s*(?:分钟|分|min)/i.exec(line);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h <= 24 && m < 60) return Math.round(((h * 60 + m) / 60) * 100) / 100;
  }
  const h = /(\d{1,2}(?:[.,]\d+)?)\s*(?:小时|时|hrs?|h)(?=[^a-z]|$)/i.exec(line);
  if (h) {
    const v = Number(h[1].replace(',', '.'));
    if (v > 0 && v <= 24) return Math.round(v * 100) / 100;
  }
  const m = /(\d{1,3})\s*(?:分钟|分|min)(?=[^a-z]|$)/i.exec(line);
  if (m) {
    const v = Number(m[1]);
    if (v > 0 && v <= 1440) return Math.round((v / 60) * 100) / 100;
  }
  return null;
}

function parseClock(value: string): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const SLEEP_TOTAL_LABELS = [/^睡眠时间$/, /^睡眠时长$/, /^总睡眠/, /^睡眠$/];
const SLEEP_STAGE_LABELS: { key: keyof SleepData; re: RegExp }[] = [
  { key: 'deepHours', re: /深度|深睡|deep/i },
  { key: 'coreHours', re: /核心|core/i },
  { key: 'remHours', re: /快速动眼|异相睡眠|\brem\b/i },
  { key: 'awakeHours', re: /清醒|awake/i },
];

// 解析睡眠截图（Apple「健康」睡眠 - 日视图）
// 只认「睡眠时间」标签后的值；不做全文最大值猜测；时钟只在有明确标签时才用
export function parseSleepText(rawText: string): SleepAnalysis {
  const text = normalizeOcrText(rawText);
  const allLines = text.split('\n');
  const warnings: string[] = [];
  const hints: string[] = [];
  const pendingFields: string[] = [];
  const sleep: Partial<SleepData> = {};

  // 只处理第一个睡眠相关标签之后的内容，避免把同一张长截图里的活动数据算进来
  const startIdx = allLines.findIndex((l) =>
    /睡眠时间|睡眠时长|快速动眼|核心睡眠|深度睡眠|清醒时间|^睡眠$/.test(l),
  );
  const lines = startIdx >= 0 ? allLines.slice(startIdx) : allLines;

  // 1) 总睡眠：标签行 → 值（同一行或紧邻的下一行）
  for (let i = 0; i < lines.length && sleep.totalHours == null; i += 1) {
    const line = lines[i];
    if (!SLEEP_TOTAL_LABELS.some((re) => re.test(line))) continue;
    const candidates = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''];
    for (const c of candidates) {
      if (!c || NOT_DAILY_RE.test(c)) continue;
      if (c !== line && METRIC_LABEL_RE.test(c) && !/\d/.test(c)) continue;
      if (c !== line && /站立|锻炼|活动|步数|距离|心率|楼层|奖章/.test(c)) continue;
      const hours = parseDurationHours(c);
      if (hours == null) continue;
      if (hours < 0.5 || hours > 14) {
        warnings.push(
          `截图里出现的睡眠时长是 ${sleepDurationText(hours)}，超出正常单日范围，已留空请你核对`,
        );
        break;
      }
      sleep.totalHours = hours;
      break;
    }
  }

  // 2) 分期
  for (const { key, re } of SLEEP_STAGE_LABELS) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!re.test(line)) continue;
      const candidates = [line, lines[i + 1] ?? ''];
      let done = false;
      for (const c of candidates) {
        if (!c) continue;
        if (c !== line && /站立|锻炼|活动|步数|距离|心率|楼层|奖章|平均|周|月/.test(c)) continue;
        const hours = parseDurationHours(c);
        if (hours == null || hours > 14) continue;
        (sleep as Record<string, unknown>)[key] = hours;
        done = true;
        break;
      }
      if (done) break;
    }
  }

  // 3) 就寝 / 起床：只在有明确标签的行里取（不用状态栏、坐标轴、图表时间）
  const bedLine = lines.find((l) => /就寝|入睡|上床|开始睡眠/.test(l));
  const wakeLine = lines.find((l) => /起床|醒来|睡醒|结束睡眠/.test(l));
  const bedClock = bedLine ? parseClock(bedLine) : null;
  const wakeClock = wakeLine ? parseClock(wakeLine) : null;
  if (bedClock) sleep.sleepTime = bedClock;
  if (wakeClock) sleep.wakeTime = wakeClock;
  if (!bedClock || !wakeClock) {
    // 睡眠段落里的 "23:50 - 07:10" 这种"时间范围"可以用（不是单个时钟，也不是坐标轴）
    const range = /(\d{1,2}:\d{2})\s*[-–—~至]\s*(\d{1,2}:\d{2})/.exec(lines.join(' '));
    if (range) {
      const from = parseClock(range[1]);
      const to = parseClock(range[2]);
      const fromH = from ? Number(from.slice(0, 2)) + Number(from.slice(3)) / 60 : null;
      const toH = to ? Number(to.slice(0, 2)) + Number(to.slice(3)) / 60 : null;
      // 跨零点：结束时间在开始之后（按一天折算）
      const span = fromH != null && toH != null ? (toH - fromH + 24) % 24 : null;
      if (from && to && span != null && span >= 0.5 && span <= 14) {
        if (!sleep.sleepTime) sleep.sleepTime = from;
        if (!sleep.wakeTime) sleep.wakeTime = to;
      }
    }
  }
  if (sleep.sleepTime) sleep.bedTime = sleep.sleepTime;
  if (!sleep.sleepTime && !sleep.wakeTime) {
    hints.push('这张截图里没有明确标注入睡/起床时间，已留空（需要的话可以手动填）');
  }

  // 4) 午睡
  const napIdx = lines.findIndex((l) => /午睡|小睡|nap/i.test(l));
  if (napIdx >= 0) {
    const target = lines[napIdx];
    const m =
      /(\d{1,3})\s*(?:分钟|分|min)/i.exec(target) ??
      /(\d{1,3})\s*(?:分钟|分|min)/i.exec(lines[napIdx + 1] ?? '');
    if (m) {
      const v = Number(m[1]);
      if (v > 0 && v <= 600) sleep.napMinutes = v;
    }
  }

  // 5) 质量评分
  const qualityLine = lines.find((l) => /睡眠质量|质量|评分|quality/i.test(l));
  if (qualityLine) {
    const v = numbersIn(qualityLine).find((n) => n >= 1 && n <= 5);
    if (v) sleep.quality = v;
  }

  // 6) 交叉校验：分期合计明显大于总时长 → 标记待确认
  const stageSum =
    (sleep.deepHours ?? 0) + (sleep.coreHours ?? 0) + (sleep.remHours ?? 0) + (sleep.awakeHours ?? 0);
  if (sleep.totalHours != null && stageSum > 0 && stageSum - sleep.totalHours > 2.5) {
    if (!pendingFields.includes('总睡眠时长')) pendingFields.push('总睡眠时长');
    warnings.push(
      `睡眠时长（${sleepDurationText(sleep.totalHours)}）与各分期合计（${sleepDurationText(stageSum)}）对不上，请核对`,
    );
  }
  if (sleep.totalHours != null && (sleep.totalHours < 2 || sleep.totalHours > 12)) {
    if (!pendingFields.includes('总睡眠时长')) pendingFields.push('总睡眠时长');
    warnings.push(`识别到的睡眠时长 ${sleepDurationText(sleep.totalHours)} 偏异常，请核对后再保存`);
  }

  const found = Object.values(sleep).filter((v) => v != null).length;
  if (found === 0) {
    warnings.push(
      '没提取到睡眠数据：请上传「健康 → 睡眠 → 日」视图截图（能看到睡眠时间与分期）',
    );
  } else {
    hints.push(
      sleep.totalHours != null
        ? `睡眠时长：${sleepDurationText(sleep.totalHours)}，请确认后进入下一步`
        : `识别到 ${found} 项睡眠数据（没有读到总时长，可手动补充）`,
    );
  }
  return {
    kind: 'sleep',
    text,
    sleep,
    pendingFields,
    hints,
    warnings,
    status: found === 0 ? 'empty' : pendingFields.length ? 'partial' : 'ok',
  };
}

// --------------------------- 统一入口 ---------------------------

// 解析一张 Apple Watch / 健身 / 健康截图：先判断类型，再走对应解析器
export function parseWatchText(rawText: string): WatchAnalysis {
  const kind = classifyHealthText(rawText);
  if (kind === 'workout') return parseWorkoutText(rawText);
  if (kind === 'activity') return parseActivityText(rawText);
  if (kind === 'sleep') {
    const parsed = parseSleepText(rawText);
    return {
      kind: 'sleep',
      text: parsed.text,
      fields: {},
      workoutFields: {},
      hints: parsed.hints,
      warnings: [
        '这张看起来是睡眠截图，已按睡眠解析；建议到「睡眠」步骤上传，字段会更完整',
        ...parsed.warnings,
      ],
      status: parsed.status,
      pendingFields: parsed.pendingFields,
    };
  }
  return {
    kind: 'unknown',
    text: normalizeOcrText(rawText),
    fields: {},
    workoutFields: {},
    hints: [],
    warnings: [
      '这张截图没有识别到可用的运动/睡眠数据（支持「健身」摘要、活动详情、体能训练详细信息、「健康」睡眠日视图）',
    ],
    status: 'empty',
    pendingFields: [],
  };
}

// ------------------------------ 多图合并 ------------------------------

export interface MergedWatchResult {
  merged: WatchData;
  // 贡献了数据的截图数量
  usedScreenshots: number;
  // 判定为重复（与已有截图数据一致）的截图数量
  duplicates: number;
  notes: string[];
  perScreenshot: {
    index: number;
    kind: ScreenshotKind;
    fields: Partial<Record<WatchFieldKey, OcrField<number>>>;
    pendingFields: string[];
    warnings: string[];
  }[];
}

// 同一天多张全天活动截图合并：同名指标取最大值（不会两次累计），完全重复的截图不计
export function mergeWatchAnalyses(analyses: WatchAnalysis[]): MergedWatchResult {
  const merged: WatchData = {};
  const notes: string[] = [];
  let duplicates = 0;

  const signature = (a: WatchAnalysis) =>
    Object.entries(a.fields)
      .map(([k, v]) => `${k}:${v?.value}`)
      .sort()
      .join('|');
  const seen = new Set<string>();

  for (const [index, analysis] of analyses.entries()) {
    const sig = signature(analysis);
    if (sig && seen.has(sig)) {
      duplicates += 1;
      notes.push(`第 ${index + 1} 张截图与前面的数据相同，已按同一天合并，不重复计算`);
      continue;
    }
    if (sig) seen.add(sig);

    for (const [key, field] of Object.entries(analysis.fields) as [WatchFieldKey, OcrField<number>][]) {
      if (!field) continue;
      // 待确认的字段照样填入并打上标记（界面会提示核对）；明显不合理的值在解析阶段就已经被丢弃
      const current = merged[key] as number | null | undefined;
      merged[key] = (typeof current === 'number'
        ? Math.max(current, field.value)
        : field.value) as never;
    }
  }

  const usedScreenshots = analyses.length - duplicates;
  if (analyses.length > 1) {
    notes.push(
      `共 ${analyses.length} 张截图，合并后使用 ${usedScreenshots} 张的数据（同一天的同名指标取最大值，不累加）`,
    );
  }
  return {
    merged,
    usedScreenshots,
    duplicates,
    notes,
    perScreenshot: analyses.map((a, index) => ({
      index,
      kind: a.kind,
      fields: a.fields,
      pendingFields: a.pendingFields,
      warnings: a.warnings,
    })),
  };
}
