/**
 * 健身计划解析：把 PDF 文本 -> PlanDraft（可编辑草稿）
 * 纯函数，覆盖 ChatGPT 常见的 Markdown、表格、逐行字段三种排版。
 */
import { uid } from '../format';
import type {
  ExerciseItem,
  PlanDraft,
  SessionKind,
  TargetSpec,
  WarmupItem,
} from '../../types';
import {
  cleanLines,
  isHeading,
  matchLabel,
  normalizeText,
  parseDateLoose,
  parseDurationSec,
  stripBullet,
  tableCells,
} from './text';

const WARMUP_HEADINGS = ['热身', '准备活动', '激活', 'warm up', 'warmup', '热身环节'];
const MAIN_HEADINGS = [
  '正式训练', '主训练', '训练内容', '训练动作', '动作安排', '主体',
  '训练计划', '力量训练', '有氧训练', '专项训练', '今天训练', '训练安排', '主要训练',
];
const COOLDOWN_HEADINGS = ['拉伸', '放松', '冷身', '整理活动', '恢复', '泡沫轴', 'cooldown'];
const NOTE_HEADINGS = ['备注', '注意事项', '说明', '教练备注', '提示', '注意'];

const CUE_LABELS = ['动作要领', '技术要点', '要领', '要点', '技巧', '做法', '提示', '发力'];
const NOTE_LABELS = ['注意事项', '注意', '提醒', '风险', '警告', '疼痛时', '不适时', '禁忌'];

type Section = 'meta' | 'warmup' | 'main' | 'cooldown' | 'notes';

interface Block {
  head: string;
  lines: string[];
  fromTable?: boolean;
}

const RUN_RE = /跑|冲刺|慢跑|间歇|百米|折返跑/;
const RIDE_RE = /骑行|单车|自行车|功率车|动感单车|骑/;
const BALL_RE = /足球|带球|射门|传球|绕杆|对抗|小场|颠球|盘带/;
const STRETCH_RE = /拉伸|放松|泡沫轴|瑜伽|筋膜|活动度/;

function kindFromName(name: string, fallback: SessionKind): SessionKind {
  if (BALL_RE.test(name)) return 'football';
  if (RIDE_RE.test(name)) return 'ride';
  if (RUN_RE.test(name)) return 'run';
  if (STRETCH_RE.test(name)) return 'stretch';
  return fallback;
}

/* ------------------------------------------------------------------ 目标 */

export function parseTargetFromText(text: string): TargetSpec {
  const t = normalizeText(text);
  const target: TargetSpec = {};

  // 组数 × 次数（4x5、4 组 × 5 次、4组x8-12次）
  const sxr = t.match(/(\d{1,2})\s*(?:组)?\s*[x×*]\s*(\d{1,3}(?:\s*[-–~]\s*\d{1,3})?)\s*(?:次|个|reps?)?/i);
  const setsOnly = t.match(/(\d{1,2})\s*组/);
  const setsLabel = t.match(/组数\s*[:：]?\s*(\d{1,2})/);
  if (setsLabel) target.sets = Number(setsLabel[1]);
  else if (sxr) target.sets = Number(sxr[1]);
  else if (setsOnly) target.sets = Number(setsOnly[1]);

  const repsLabel = t.match(/次数\s*[:：]?\s*(\d{1,3}(?:\s*[-–~]\s*\d{1,3})?)/);
  const repsText = t.match(/(\d{1,3}(?:\s*[-–~]\s*\d{1,3})?)\s*(?:次|个|reps?)/i);
  if (repsLabel) target.reps = repsLabel[1].replace(/\s/g, '');
  else if (sxr && sxr[2]) target.reps = sxr[2].replace(/\s/g, '');
  else if (repsText) target.reps = repsText[1].replace(/\s/g, '');
  else if (/力竭|amrap/i.test(t)) target.reps = '力竭';
  else if (target.sets == null && sxr) target.reps = sxr[2]?.replace(/\s/g, '') ?? null;

  // 重量
  const kg = t.match(/(?:重量|负重|负荷|使用)?\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:kg|公斤|千克)/i);
  const at = t.match(/@\s*(\d{1,3}(?:\.\d+)?)\s*(?:kg|公斤)?/i);
  const lb = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:lb|磅)/i);
  const pct = t.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:1rm|rm)/i);
  if (kg) target.weightKg = Number(kg[1]);
  else if (at) target.weightKg = Number(at[1]);
  else if (lb) target.weightKg = Math.round(Number(lb[1]) * 0.4536 * 10) / 10;
  else if (pct) target.weightText = `${pct[1]}% 1RM`;
  else if (/空杆/.test(t)) target.weightText = '空杆';
  else if (/自重|徒手|无负重/.test(t)) target.weightText = '自重';

  // 组间休息
  const rest = t.match(/(?:组间|组内|间歇)?\s*休息\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(秒|s\b|sec|分钟|分|min)?/i);
  if (rest) {
    const unit = rest[2] ?? '秒';
    const n = Number(rest[1]);
    target.restSec = /分|min/.test(unit) ? Math.round(n * 60) : Math.round(n);
  } else {
    const rest2 = t.match(/(\d{1,3})\s*(?:秒|s)\s*(?:组间休息|间歇)/i);
    if (rest2) target.restSec = Number(rest2[1]);
  }

  // RPE / RIR
  const rpe = t.match(/rpe\s*[:：]?\s*(\d{1,2}(?:\.\d+)?)/i);
  const rpe2 = t.match(/(\d{1,2}(?:\.\d+)?)\s*rpe/i);
  const rir = t.match(/rir\s*[:：]?\s*(\d{1,2})/i);
  if (rpe) target.rpe = Number(rpe[1]);
  else if (rpe2) target.rpe = Number(rpe2[1]);
  else if (rir) target.rpeText = `RIR ${rir[1]}`;

  // 节奏
  const tempo = t.match(/节奏\s*[:：]?\s*([\d]+(?:\s*[-–:]\s*\d+){1,3})/);
  if (tempo) target.tempo = tempo[1].replace(/\s/g, '');

  // 时间型（平板支撑、静蹲、有氧时长）
  const dur = t.match(/(?:时间|时长|持续|坚持|每组)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(秒|分钟|分|s\b|min)/i);
  if (dur) {
    const unit = dur[2];
    const n = Number(dur[1]);
    target.durationSec = /分|min/.test(unit) ? Math.round(n * 60) : Math.round(n);
  } else if (target.sets == null && target.reps == null) {
    const bare = t.match(/(\d{1,3})\s*(秒|分钟|min|s\b)/i);
    if (bare) {
      const unit = bare[2];
      const n = Number(bare[1]);
      target.durationSec = /分|min/.test(unit) ? Math.round(n * 60) : Math.round(n);
    }
  }

  // 距离 / 配速 / 速度 / 心率 / 上场时间
  const km = t.match(/(\d{1,3}(?:\.\d+)?)\s*(?:公里|千米|km)/i);
  const meter = t.match(/(\d{2,4})\s*(?:米|m)(?![a-z])/i);
  if (km) target.distanceKm = Number(km[1]);
  else if (meter) target.distanceKm = Math.round((Number(meter[1]) / 1000) * 100) / 100;

  const pace = t.match(/配速\s*[:：]?\s*([^\s|,，;；]{3,18})/);
  if (pace) target.paceText = pace[1];
  else if (/(\d{1,2})\s*['′]\s*(\d{1,2})/.test(t)) {
    const m = t.match(/(\d{1,2})\s*['′]\s*(\d{1,2})/);
    if (m) target.paceText = `${m[1]}'${m[2]}"/km`;
  }

  const speed = t.match(/速度\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:km\/h|公里\/小时|kph)/i);
  if (speed) target.speedKph = Number(speed[1]);

  const hr = t.match(/心率\s*[:：]?\s*(\d{2,3})/);
  if (hr) target.hrBpm = Number(hr[1]);

  const play = t.match(/(?:上场|比赛|对抗)\s*(?:时间)?\s*[:：]?\s*(\d{1,3})\s*(?:分钟|min)/);
  if (play) target.playMin = Number(play[1]);

  return target;
}

/* ---------------------------------------------------------------- 分块 */

function splitExerciseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let fieldSeen = false;

  const push = () => {
    if (current && (current.head.trim() || current.lines.length)) blocks.push(current);
    current = null;
    fieldSeen = false;
  };

  for (const raw of lines) {
    const cells = tableCells(raw);
    if (cells) {
      push();
      const name = cells[0].replace(/^(动作|名称|项目)\s*[:：]?/, '').trim();
      if (name && !/^动作$|^名称$|^项目$/.test(name)) {
        blocks.push({ head: name, lines: [cells.slice(1).join(' | ')], fromTable: true });
      }
      continue;
    }

    const { text, index } = stripBullet(raw);
    if (!text) continue;
    const looksField = /(组|次|kg|公斤|休息|rpe|配速|心率|时间|距离|要领|注意)/i.test(text);
    const isNumbered = index != null || /^[-*•·]/.test(normalizeText(raw).trim());
    const startsNew = isNumbered || (fieldSeen && !looksField) || !current;

    if (startsNew) {
      push();
      current = { head: text, lines: [] };
      fieldSeen = looksField;
    } else if (current) {
      current.lines.push(text);
      if (looksField) fieldSeen = true;
    }
  }
  push();
  return blocks;
}

const FIELD_CUT =
  /(\d{1,2}\s*组|\d{1,2}\s*[x×*]\s*\d|@\s*\d|组数|次数|重量|休息|rpe|rir|配速|心率|速度|距离|时长|时间\s*[:：]|要领|注意)/i;

function nameFromBlock(block: Block): string {
  let head = normalizeText(block.head).replace(/\s+/g, ' ').trim();
  head = head.replace(/^(动作|项目|名称|练习)\s*[:：]\s*/, '');
  const cut = head.search(FIELD_CUT);
  let name = cut > 0 ? head.slice(0, cut) : head;
  name = name
    .replace(/[|,，;；、:：\-–—]+$/, '')
    .replace(/^[|,，;；、:：\-–—\s]+/, '')
    .trim();
  if (!name) name = head.trim();
  return name.slice(0, 60);
}

function textFromLabel(block: Block, labels: string[]): string | undefined {
  const hits: string[] = [];
  for (const line of [block.head, ...block.lines]) {
    const hit = matchLabel(line, labels);
    if (hit) hits.push(hit.value.replace(/\s+/g, ' ').trim());
  }
  return hits.length ? hits.join('；') : undefined;
}

function looseCueLines(block: Block): string[] {
  return block.lines
    .filter((l) => !FIELD_CUT.test(l) && !matchLabel(l, [...CUE_LABELS, ...NOTE_LABELS]))
    .filter((l) => l.length > 2 && /[\u4e00-\u9fff]/.test(l))
    .map((l) => l.trim());
}

function exerciseFromBlock(block: Block, order: number, fallback: SessionKind): ExerciseItem | null {
  const name = nameFromBlock(block);
  if (!name) return null;
  // 纯说明行（例如标题行）过滤掉
  if (/^(训练|计划|说明|总结|备注|热身|拉伸|恢复)$/.test(name)) return null;

  const comboText = [block.head, ...block.lines].join(' | ');
  const target = parseTargetFromText(comboText);
  if (block.fromTable) {
    const cells = block.lines[0]?.split('|').map((c) => c.trim()) ?? [];
    for (const cell of cells) {
      const partial = parseTargetFromText(cell);
      target.sets = target.sets ?? partial.sets ?? null;
      target.reps = target.reps ?? partial.reps ?? null;
      target.weightKg = target.weightKg ?? partial.weightKg ?? null;
      target.restSec = target.restSec ?? partial.restSec ?? null;
      target.rpe = target.rpe ?? partial.rpe ?? null;
    }
  }

  const cue = textFromLabel(block, CUE_LABELS) ?? looseCueLines(block)[0];
  const notes = textFromLabel(block, NOTE_LABELS) ?? looseCueLines(block).slice(1).join('；') || undefined;

  if (
    target.sets == null &&
    target.reps == null &&
    target.weightKg == null &&
    target.durationSec == null &&
    target.distanceKm == null
  ) {
    // 完全没有训练信息，且名字很短 —— 很可能是噪声
    if (name.length < 2) return null;
  }

  return {
    id: uid('ex'),
    name,
    kind: kindFromName(name, fallback),
    cue,
    notes: notes || undefined,
    target,
    order,
  };
}

function parseWarmupLines(lines: string[]): WarmupItem[] {
  const items: WarmupItem[] = [];
  for (const raw of lines) {
    const { text } = stripBullet(raw);
    if (!text) continue;
    const cells = tableCells(raw);
    const content = cells ? cells.join(' ') : text;
    const cut = content.search(FIELD_CUT);
    let name = cut > 0 ? content.slice(0, cut) : content;
    const t = parseTargetFromText(content);
    const durationSec =
      t.durationSec ?? (/热身|拉伸|慢跑|激活|放松/.test(content) ? parseDurationSec(content) : null);
    if (!name.trim()) name = content;
    const detailParts: string[] = [];
    if (t.sets && t.reps) detailParts.push(`${t.sets} 组 × ${t.reps} 次`);
    else if (t.distanceKm) detailParts.push(`${t.distanceKm} km`);
    if (t.hrBpm) detailParts.push(`心率 ${t.hrBpm}`);
    if (durationSec) detailParts.push(`${Math.round(durationSec / 60) || 1} 分钟`);
    const rest = content.replace(name, '').replace(/^[\s|,，;；:：]+/, '').trim();
    items.push({
      name: name.replace(/[:：\s]+$/, '').slice(0, 40),
      detail: detailParts.length ? detailParts.join(' · ') : rest || undefined,
      durationSec: durationSec ?? null,
    });
  }
  return items.filter((w) => w.name.length > 0).slice(0, 12);
}

function detectSessionKind(text: string): SessionKind {
  const score = (re: RegExp) => (text.match(re) ?? []).length;
  const run = score(/跑|配速|心率|间歇/g);
  const ride = score(/骑行|单车|自行车|功率/g);
  const ball = score(/足球|带球|射门|对抗|绕杆|上场/g);
  const stretch = score(/拉伸|放松|泡沫轴|瑜伽/g);
  const strength = score(/组|次|kg|公斤|深蹲|硬拉|卧推|推举|划船|蹲|举/g);
  const max = Math.max(run, ride, ball, stretch, strength);
  if (max === 0) return 'strength';
  if (max === strength) return 'strength';
  if (max === ball) return 'football';
  if (max === run) return 'run';
  if (max === ride) return 'ride';
  return 'stretch';
}

function guessTitle(lines: string[], fileName?: string): string {
  for (const line of lines.slice(0, 6)) {
    const hit = matchLabel(line, ['计划名称', '训练名称', '标题', '主题']);
    if (hit) return hit.value.replace(/[。.]$/, '');
  }
  for (const line of lines.slice(0, 5)) {
    const t = line.replace(/^[#*\s]+/, '').trim();
    if (!t) continue;
    if (/^\d/.test(t)) continue;
    if (/^(计划|训练)?\s*(日期|时间|时长)/.test(t)) continue;
    if (parseDateLoose(t) && t.length <= 14) continue;
    if (/^(健身|训练|周|今日).{0,4}(计划|安排|记录)$/.test(t)) continue;
    if (t.length > 42) continue;
    return t.replace(/[:：]\s*$/, '');
  }
  if (fileName) {
    return fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || '导入的训练计划';
  }
  return '导入的训练计划';
}

function guessMinutes(lines: string[]): number | null {
  for (const line of lines.slice(0, 12)) {
    const hit = matchLabel(line, ['预计时长', '预计训练时间', '总时长', '训练时长', '时长', '用时']);
    const source = hit?.value ?? (/(预计|大约|约)?\s*\d{1,3}\s*[-–~到至]\s*\d{1,3}\s*(分钟|min)/i.test(line) ? line : null);
    if (!source) continue;
    const range = source.match(/(\d{1,3})\s*[-–~到至]\s*(\d{1,3})/);
    if (range) return Number(range[2]);
    const single = source.match(/(\d{1,3})\s*(?:分钟|min|分)/i);
    if (single) return Number(single[1]);
  }
  return null;
}

/* ---------------------------------------------------------------- 主入口 */

export interface ParsePlanOptions {
  fileName?: string;
  importId: string;
  today?: string;
}

interface PlanBody {
  title: string;
  date: string | null;
  sessionKind: SessionKind;
  estimatedMinutes: number | null;
  warmup: WarmupItem[];
  exercises: ExerciseItem[];
  cooldown: string;
  notes: string;
  confidence: number;
  warnings: string[];
}

export function parsePlanBody(text: string, opts: ParsePlanOptions): PlanBody {
  const lines = cleanLines(text);
  const sessionKind = detectSessionKind(text);
  const warnings: string[] = [];

  // 1. 分节
  const sections: Record<Section, string[]> = {
    meta: [],
    warmup: [],
    main: [],
    cooldown: [],
    notes: [],
  };
  let current: Section = 'meta';
  for (const line of lines) {
    if (isHeading(line, WARMUP_HEADINGS)) {
      current = 'warmup';
      continue;
    }
    if (isHeading(line, NOTE_HEADINGS) && !isHeading(line, MAIN_HEADINGS)) {
      current = 'notes';
      continue;
    }
    if (isHeading(line, COOLDOWN_HEADINGS) && !isHeading(line, MAIN_HEADINGS)) {
      current = 'cooldown';
      continue;
    }
    if (isHeading(line, MAIN_HEADINGS)) {
      current = 'main';
      continue;
    }
    sections[current].push(line);
  }

  const metaLines = sections.meta;
  const dateHit = metaLines.map((l) => parseDateLoose(l)).find((d) => d) ?? parseDateLoose(opts.fileName ?? '');
  const title = guessTitle(lines, opts.fileName);
  const estimatedMinutes = guessMinutes(lines);

  // 2. 热身
  let warmup = parseWarmupLines(sections.warmup);
  if (!warmup.length) {
    // 没有热身小节时，从 meta 里找「热身」开头的行
    const inline = lines.filter((l) => /^热身/.test(normalizeText(l)) && !isHeading(l, WARMUP_HEADINGS));
    if (inline.length) warmup = parseWarmupLines(inline);
  }

  // 3. 正式训练动作
  let mainLines = sections.main;
  if (!mainLines.length) {
    mainLines = lines.filter((l) => !metaLines.includes(l) && !sections.notes.includes(l) && !sections.cooldown.includes(l));
  }
  const blocks = splitExerciseBlocks(mainLines);
  const exercises: ExerciseItem[] = [];
  for (const b of blocks) {
    const ex = exerciseFromBlock(b, exercises.length, sessionKind);
    if (ex) exercises.push(ex);
  }

  // 4. 拉伸 / 恢复 / 备注
  const cooldown = sections.cooldown.join('\n').trim();
  const notes = [sections.notes.join('\n').trim(), sections.cooldown.length ? '' : ''].filter(Boolean).join('\n');

  // 5. 置信度与提示
  let score = 0;
  const total = 5;
  if (title && title !== '导入的训练计划') score += 1;
  if (dateHit) score += 1;
  if (warmup.length) score += 0.5;
  if (exercises.length) score += 1.5;
  if (exercises.some((e) => e.target.sets && e.target.reps)) score += 1;
  const confidence = Math.max(0.1, Math.min(1, score / total));

  if (!exercises.length) warnings.push('没有识别到训练动作，请手动添加，或确认 PDF 是否为文字型文件。');
  if (!dateHit) warnings.push('未识别到训练日期，已默认使用今天，可手动修改。');
  const noTargets = exercises.filter((e) => !e.target.sets && !e.target.reps && !e.target.durationSec);
  if (noTargets.length) warnings.push(`有 ${noTargets.length} 个动作未识别到组数/次数，请手动补全。`);
  if (exercises.length > 0 && exercises.length < 2) warnings.push('只识别到 1 个动作，请检查 PDF 排版是否为多列。');

  return {
    title,
    date: dateHit,
    sessionKind,
    estimatedMinutes,
    warmup,
    exercises,
    cooldown,
    notes,
    confidence,
    warnings,
  };
}

export function parsePlanText(text: string, opts: ParsePlanOptions): PlanDraft {
  const body = parsePlanBody(text, opts);
  return {
    kind: 'plan',
    importId: opts.importId,
    fileName: opts.fileName ?? '导入的计划.pdf',
    title: body.title,
    date: body.date,
    sessionKind: body.sessionKind,
    estimatedMinutes: body.estimatedMinutes,
    warmup: body.warmup,
    exercises: body.exercises,
    cooldown: body.cooldown,
    notes: body.notes,
    confidence: body.confidence,
    warnings: body.warnings,
  };
}

/* -------------------------------------------------------------- 周计划 */

const DAY_RE =
  /^(?:第\s*[一二三四五六日天1-7]\s*天|周[一二三四五六日天]|星期[一二三四五六日天]|mon|tue|wed|thu|fri|sat|sun|day\s*[1-7])/i;

export function parseWeeklyPlanBody(
  text: string,
  opts: ParsePlanOptions,
): { days: PlanDraft[]; warnings: string[] } {
  const lines = cleanLines(text);
  const groups: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const t = normalizeText(line).replace(/^[#*\s]+/, '');
    const dayMatch = t.match(DAY_RE);
    if (dayMatch) {
      if (current) groups.push(current);
      const date = parseDateLoose(t);
      const label = t.slice(0, 22).replace(/[:：\s]+$/, '');
      current = { title: label, lines: date ? [t] : [t] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) groups.push(current);

  const warnings: string[] = [];
  const days: PlanDraft[] = [];
  groups.forEach((g, i) => {
    const body = parsePlanBody(g.lines.join('\n'), {
      ...opts,
      fileName: opts.fileName,
      importId: opts.importId,
    });
    if (!body.exercises.length && !/休息|恢复|休息日/.test(g.title + g.lines.join(''))) return;
    const rest = /休息|恢复日|off/i.test(g.title);
    days.push({
      kind: 'plan',
      importId: opts.importId,
      fileName: opts.fileName ?? '导入的周计划.pdf',
      title: body.title && body.title !== '导入的训练计划' ? `${g.title} · ${body.title}` : g.title,
      date: body.date ?? addDaysToToday(i),
      sessionKind: rest ? 'recovery' : body.sessionKind,
      estimatedMinutes: body.estimatedMinutes,
      warmup: body.warmup,
      exercises: body.exercises,
      cooldown: body.cooldown,
      notes: body.notes,
      confidence: body.confidence,
      warnings: body.warnings,
    });
  });

  if (!days.length) warnings.push('没有识别到按天划分的训练安排，请改用「健身计划」重新导入。');
  if (days.length > 0 && days.every((d) => d.exercises.length === 0)) {
    warnings.push('每天都没识别到动作，可能是版式过复杂，建议手动补全。');
  }
  return { days, warnings };
}

function addDaysToToday(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}
