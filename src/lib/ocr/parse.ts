/**
 * 截图文字 → 结构化数据（Apple Watch / 睡眠）
 * 规则：只填识别到的字段；识别不到就留空；数值做范围校验，避免把日期、时间误当数据。
 */
import type { SleepData, WatchData } from '../../types';

export interface OcrField<T = number> {
  value: T;
  /** 命中的原文片段，便于用户核对 */
  evidence: string;
  /** 该字段来自哪张截图 */
  source: number;
}

export type WatchFieldKey = keyof WatchData;

export interface WatchAnalysis {
  /** 原始文字（用于排查与展示） */
  text: string;
  fields: Partial<Record<WatchFieldKey, OcrField<number>>>;
  hints: string[];
  warnings: string[];
}

export interface SleepAnalysis {
  text: string;
  sleep: Partial<SleepData>;
  hints: string[];
  warnings: string[];
}

/* ----------------------------- 文本预处理 ----------------------------- */

const FULLWIDTH = '０１２３４５６７８９：．，';
const HALFWIDTH = '0123456789:.,';

export function normalizeOcrText(input: string): string {
  let out = input ?? '';
  for (let i = 0; i < FULLWIDTH.length; i += 1) {
    out = out.split(FULLWIDTH[i]).join(HALFWIDTH[i]);
  }
  return out
    .replace(/[|｜]/g, ' ')
    // OCR 常在汉字之间插入空格（"活 动 能 量"），去掉后才好匹配标签
    // 只去掉同一行内的空格，不能跨越换行（否则会把两行内容粘成一行）
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
    // 单位里的斜杠两侧空格（"次 /分"）
    .replace(/\s*\/\s*/g, '/')
    // 常见误识别：干卡→千卡
    .replace(/干卡/g, '千卡')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

const numbersIn = (line: string): number[] =>
  (line.match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((s) => Number(s.replace(',', '.')))
    .filter((n) => Number.isFinite(n));

/* -------------------------- Apple Watch 指标定义 -------------------------- */

interface MetricSpec {
  key: WatchFieldKey;
  labels: RegExp[];
  units: RegExp[];
  min: number;
  max: number;
}

const METRICS: MetricSpec[] = [
  {
    key: 'activeEnergyKcal',
    labels: [/活动能量/, /活动/, /active\s*energy/i],
    units: [/千卡/, /大卡/, /kcal/i, /卡路里/],
    min: 1,
    max: 8000,
  },
  {
    key: 'totalEnergyKcal',
    labels: [/总消耗/, /总能量/, /total\s*energy/i, /总卡路里/],
    units: [/千卡/, /大卡/, /kcal/i, /卡路里/],
    min: 1,
    max: 12000,
  },
  {
    key: 'exerciseMinutes',
    labels: [/锻炼/, /运动时间/, /运动分钟/, /exercise/i, /训练时间/],
    units: [/分钟/, /min/i, /分\b/],
    min: 1,
    max: 1440,
  },
  {
    key: 'standHours',
    labels: [/站立/, /stand/i],
    units: [/小时/, /hr?s?\b/i],
    min: 1,
    max: 24,
  },
  {
    key: 'steps',
    labels: [/步数/, /steps?/i],
    units: [/步/, /steps?/i],
    min: 1,
    max: 200000,
  },
  {
    key: 'avgHr',
    labels: [/平均心率/, /平均/, /average/i, /avg/i],
    units: [/次\/分/, /bpm/i, /次每分/],
    min: 30,
    max: 220,
  },
  {
    key: 'maxHr',
    labels: [/最高心率/, /最高/, /maximum/i, /max/i],
    units: [/次\/分/, /bpm/i, /次每分/],
    min: 30,
    max: 230,
  },
  {
    key: 'restingHr',
    labels: [/静息心率/, /静息/, /resting/i],
    units: [/次\/分/, /bpm/i, /次每分/],
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
    units: [/%/, /％/],
    min: 60,
    max: 100,
  },
];

/** 在给定行里挑出最贴近单位/标签的数值 */
function pickValue(line: string, spec: MetricSpec): number | null {
  const nums = numbersIn(line);
  if (!nums.length) return null;

  // 优先取紧邻单位的数字（例如 "620 千卡" / "620kcal"）
  for (const unit of spec.units) {
    const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${unit.source})`, 'i');
    const m = re.exec(line);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (v >= spec.min && v <= spec.max) return v;
    }
  }
  // 其次取单位在前的写法（例如 "千卡 620"）
  for (const unit of spec.units) {
    const re = new RegExp(`(?:${unit.source})\\s*[:：]?\\s*(\\d+(?:[.,]\\d+)?)`, 'i');
    const m = re.exec(line);
    if (m) {
      const v = Number(m[1].replace(',', '.'));
      if (v >= spec.min && v <= spec.max) return v;
    }
  }
  // 最后取行内第一个合法范围数字（Apple 健康常把大数字与标签分行）
  for (const v of nums) {
    if (v >= spec.min && v <= spec.max) return v;
  }
  return null;
}

/** 解析一张 Apple Watch / 健身 App 截图的文字 */
export function parseWatchText(rawText: string): WatchAnalysis {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n');
  const fields: WatchAnalysis['fields'] = {};
  const hints: string[] = [];
  const warnings: string[] = [];
  /** 已被某个指标占用的「行 + 数值」，避免同一个数字被重复填到两个字段 */
  const usedValues = new Set<string>();
  /** 已被占用的原始行（一个数值行只属于一个指标） */
  const usedLines = new Set<string>();

  const record = (spec: MetricSpec, value: number, evidence: string, sourceLine: string) => {
    const existing = fields[spec.key];
    if (existing && existing.value >= value) return;
    fields[spec.key] = { value, evidence, source: 0 };
    usedValues.add(`${evidence}|${value}`);
    usedLines.add(sourceLine);
  };

  lines.forEach((line, index) => {
    for (const spec of METRICS) {
      if (!spec.labels.some((re) => re.test(line))) continue;
      let value = pickValue(line, spec);
      let evidence = line;
      let sourceLine = line;
      if (value == null) {
        // 苹果健康常把数值放在标签的下一行；单位可能被 OCR 误识别，
        // 因此这里只看「标签下一行」的数字（并用数值范围校验），不跨行乱抓。
        const next = lines[index + 1];
        if (next) {
          const v = pickValue(next, spec);
          if (v != null) {
            value = v;
            evidence = `${line} / ${next}`;
            sourceLine = next;
          }
        }
        // 少数排版把数值放在标签上一行（仅当下一行没有数字时才看）
        if (value == null && index > 0) {
          const prev = lines[index - 1];
          const v = pickValue(prev, spec);
          if (v != null) {
            value = v;
            evidence = `${prev} / ${line}`;
            sourceLine = prev;
          }
        }
      }
      if (value != null) record(spec, value, evidence, sourceLine);
    }
  });

  // 没有标签但出现明确单位的行（例如截图裁切掉了中文标签）
  lines.forEach((line) => {
    for (const spec of METRICS) {
      if (fields[spec.key]) continue;
      if (!spec.units.some((re) => re.test(line))) continue;
      const v = pickValue(line, spec);
      // 该数值行已被别的指标占用时跳过（例如平均心率 128 不应再被当作静息心率）
      if (v != null && !usedLines.has(line) && !usedValues.has(`${line}|${v}`)) {
        fields[spec.key] = { value: v, evidence: line, source: 0 };
        usedValues.add(`${line}|${v}`);
        hints.push(`根据单位推断：${line}`);
      }
    }
  });

  const found = Object.keys(fields).length;
  if (found === 0) {
    warnings.push('没有识别到可用的运动数据，可以重试或手动填写');
  } else {
    hints.push(`识别到 ${found} 项数据，已生成结果卡片，可直接修改`);
  }
  return { text, fields, hints, warnings };
}

/* ------------------------------ 睡眠解析 ------------------------------ */

function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function parseDurationHours(line: string): number | null {
  const hm =
    /(\d{1,2})\s*(?:小时|时|h\b|hr)s?\s*(\d{1,2})\s*(?:分钟|分|min|m\b)/i.exec(line);
  if (hm) return toHours(Number(hm[1]) * 60 + Number(hm[2]));
  const h = /(\d{1,2}(?:[.,]\d+)?)\s*(?:小时|时|h\b|hrs?\b)/i.exec(line);
  if (h) return Number(h[1].replace(',', '.'));
  const m = /(\d{1,3})\s*(?:分钟|分|min\b|m\b)/i.exec(line);
  if (m) return toHours(Number(m[1]));
  return null;
}

function parseClock(value: string): string | null {
  const m = /(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${`${h}`.padStart(2, '0')}:${`${min}`.padStart(2, '0')}`;
}

/** 解析一张睡眠截图（Apple Health「睡眠」页面） */
export function parseSleepText(rawText: string): SleepAnalysis {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n');
  const sleep: Partial<SleepData> = {};
  const hints: string[] = [];
  const warnings: string[] = [];
  const clocks: string[] = [];

  for (const line of lines) {
    if (sleep.totalHours == null && /睡眠|sleep|时长|总计|在床/i.test(line)) {
      const hours = parseDurationHours(line);
      if (hours != null && hours > 0 && hours <= 24) sleep.totalHours = hours;
    }
    if (sleep.deepHours == null && /深度|深睡|deep/i.test(line)) {
      const hours = parseDurationHours(line);
      if (hours != null && hours <= 24) sleep.deepHours = hours;
    }
    if (sleep.coreHours == null && /核心|core/i.test(line)) {
      const hours = parseDurationHours(line);
      if (hours != null && hours <= 24) sleep.coreHours = hours;
    }
    if (sleep.remHours == null && /REM|快速眼动|异相/i.test(line)) {
      const hours = parseDurationHours(line);
      if (hours != null && hours <= 24) sleep.remHours = hours;
    }
    if (sleep.awakeHours == null && /清醒|醒着|awake/i.test(line)) {
      const hours = parseDurationHours(line);
      if (hours != null && hours <= 24) sleep.awakeHours = hours;
    }
    if (sleep.napMinutes == null && /午睡|小睡|nap/i.test(line)) {
      const minutes = /(\d{1,3})\s*(?:分钟|min)/i.exec(line);
      if (minutes) sleep.napMinutes = Number(minutes[1]);
    }
    for (const m of line.matchAll(/\d{1,2}:\d{2}/g)) {
      const clock = parseClock(m[0]);
      if (clock) clocks.push(clock);
    }
  }

  // 总睡眠：如果没有标签行，取全文中最大的时长
  if (sleep.totalHours == null) {
    const candidates = lines
      .map((l) => parseDurationHours(l))
      .filter((v): v is number => v != null && v > 0 && v <= 24);
    if (candidates.length) {
      sleep.totalHours = Math.max(...candidates);
      hints.push('总睡眠时长是根据截图中的最大时长推断的，请确认');
    }
  }

  // 时间：睡眠跨零点，晚上/凌晨的那个是上床时间，早上的是起床时间
  if (clocks.length >= 2) {
    const unique = [...new Set(clocks)].sort();
    const first = unique[0];
    const last = unique[unique.length - 1];
    const lastHour = Number(last.slice(0, 2));
    const eveningFirst = lastHour >= 18 || lastHour < 6;
    const bed = eveningFirst ? last : first;
    const wake = eveningFirst ? first : last;
    sleep.bedTime = bed;
    sleep.sleepTime = bed;
    sleep.wakeTime = wake;
  } else if (clocks.length === 1) {
    sleep.wakeTime = clocks[0];
  }

  // 质量：部分截图会显示 质量/评分
  const quality = /质量|评分|quality/i.exec(text);
  if (quality) {
    const nums = numbersIn(text.slice(quality.index, quality.index + 40));
    const v = nums.find((n) => n >= 1 && n <= 5);
    if (v) sleep.quality = v;
  }

  const found = Object.values(sleep).filter((v) => v != null).length;
  if (found === 0) {
    warnings.push('没有识别到睡眠数据，可以重试或手动填写');
  } else {
    hints.push(`识别到 ${found} 项睡眠数据，请确认后进入下一步`);
  }
  return { text, sleep, hints, warnings };
}

/* ------------------------------ 多图合并 ------------------------------ */

export interface MergedWatchResult {
  merged: WatchData;
  /** 贡献了数据的截图数量 */
  usedScreenshots: number;
  /** 判定为重复（与已有截图数据一致）的截图数量 */
  duplicates: number;
  notes: string[];
  /** 每张截图的字段（用于结果卡片逐张展示与纠错） */
  perScreenshot: { index: number; fields: Partial<Record<WatchFieldKey, OcrField<number>>>; warnings: string[] }[];
}

/**
 * 合并多张 Apple Watch 截图：
 * - 同一天的日程型指标（活动能量/锻炼分钟/站立/步数）取最大值，避免多张截图重复相加
 * - 心率类指标取最大值（更高强度的截图更有代表性），并在备注里说明
 * - 数据完全一致的截图判定为重复，不重复计入
 */
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

  analyses.forEach((analysis, index) => {
    const sig = signature(analysis);
    if (sig && seen.has(sig)) {
      duplicates += 1;
      notes.push(`第 ${index + 1} 张截图与前面的数据相同，已按同一次训练合并，不重复计算`);
      return;
    }
    if (sig) seen.add(sig);

    for (const [key, field] of Object.entries(analysis.fields) as [
      WatchFieldKey,
      OcrField<number>,
    ][]) {
      if (!field) continue;
      const current = merged[key] as number | null | undefined;
      if (typeof current === 'number') {
        merged[key] = Math.max(current, field.value) as never;
      } else {
        merged[key] = field.value as never;
      }
    }
  });

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
      fields: a.fields,
      warnings: a.warnings,
    })),
  };
}
