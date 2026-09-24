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
  firstNumber,
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
const COOLDOWN_HEADINGS = ['收尾', '拉伸', '放松', '冷身', '整理活动', '恢复', '泡沫轴', 'cooldown'];
const NOTE_HEADINGS = ['备注', '注意事项', '说明', '教练备注', '提示', '注意'];

const CUE_LABELS = ['动作要领', '技术要点', '要领', '要点', '技巧', '做法', '提示', '发力'];
const NOTE_LABELS = ['注意事项', '注意', '提醒', '风险', '警告', '疼痛时', '不适时', '禁忌'];

type Section = 'meta' | 'warmup' | 'main' | 'cooldown' | 'notes';

interface Block {
  head: string;
  lines: string[];
  fromTable?: boolean;
  /** 表格行的单元格 */
  cells?: string[];
  /** 该表格的表头（用于按列取数） */
  header?: string[];
  /** 边界由启发式推断（例如混合编号中无编号的动作） */
  inferred?: boolean;
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
  const setsRange = t.match(/(\d{1,2})\s*[-–~]\s*(\d{1,2})\s*组/);
  const setsLabel = t.match(/组数\s*[:：]?\s*(\d{1,2})/);
  if (setsLabel) target.sets = Number(setsLabel[1]);
  else if (setsRange) {
    target.setsText = `${setsRange[1]}-${setsRange[2]}`;
    target.sets = Number(setsRange[2]);
  } else if (sxr) target.sets = Number(sxr[1]);
  else if (setsOnly) target.sets = Number(setsOnly[1]);

  const repsLabel = t.match(/次数\s*[:：]?\s*(\d{1,3}(?:\s*[-–~]\s*\d{1,3})?)/);
  const repsText = t.match(/(\d{1,3}(?:\s*[-–~]\s*\d{1,3})?)\s*(?:次|个|reps?)/i);
  if (repsLabel) target.reps = repsLabel[1].replace(/\s/g, '');
  else if (sxr && sxr[2]) target.reps = sxr[2].replace(/\s/g, '');
  else if (repsText) target.reps = repsText[1].replace(/\s/g, '');
  else if (/力竭|amrap/i.test(t)) target.reps = '力竭';
  else if (target.sets == null && sxr) target.reps = sxr[2]?.replace(/\s/g, '') ?? null;

  // 时间型动作：秒数不能塞进 reps，否则跟练会显示成“次”。
  // 范围保留原文，durationSec 存上限供默认计时与记录使用。
  const timedAfterX = t.match(
    /[x×*]\s*(\d{1,3})(?:\s*[-–~]\s*(\d{1,3}))?\s*(秒|分钟|分|s\b|min)(?:\s*\/\s*(侧|边))?/i,
  );
  if (timedAfterX) {
    const min = Number(timedAfterX[1]);
    const max = Number(timedAfterX[2] ?? timedAfterX[1]);
    const unit = /分|min/i.test(timedAfterX[3]) ? '分钟' : '秒';
    const factor = unit === '分钟' ? 60 : 1;
    const perSide = Boolean(timedAfterX[4]);
    const side = perSide ? '/侧' : '';
    target.durationSec = Math.round(max * factor);
    target.durationText = `${min === max ? min : `${min}-${max}`}${unit}${side}`;
    target.durationPerSide = perSide;
    target.reps = null;
  }

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
  const dur =
    t.match(/[x×*]\s*(\d{1,3}(?:\.\d+)?)\s*(秒|分钟|分|s\b|min)/i) ??
    t.match(/(?:时间|时长|持续|坚持|每组)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(秒|分钟|分|s\b|min)/i);
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
  // 「3 组 60 秒」「3组×40秒」这类等长训练：没有次数但有秒数
  if (target.durationSec == null && target.reps == null && target.sets != null) {
    const isometric = t.match(/(\d{1,3})\s*(秒|分钟|min|s\b)/i);
    if (isometric) {
      const unit = isometric[2];
      const n = Number(isometric[1]);
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
  let tableHeader: string[] | null = null;

  const push = () => {
    if (current && (current.head.trim() || current.lines.length)) blocks.push(current);
    current = null;
    fieldSeen = false;
  };

  const numbered = (line: string): boolean => {
    if (tableCells(line)) return false;
    const bullet = stripBullet(line);
    return bullet.index != null && bullet.text.length > 0;
  };
  const numberedMode = lines.filter(numbered).length >= 2;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const cells = tableCells(raw);
    if (cells) {
      const isHeaderRow =
        /动作|名称|项目|练习|exercise/i.test(cells[0]) ||
        cells.some((c) => /^(组数|次数|重量|休息|间歇|rpe|sets|reps|weight|rest)$/i.test(c.trim()));
      if (isHeaderRow && !/\d/.test(cells.join(''))) {
        tableHeader = cells;
        push();
        continue;
      }
      push();
      const name = cells[0].replace(/^(动作|名称|项目)\s*[:：]?/, '').trim();
      if (name && !/^动作$|^名称$|^项目$/.test(name)) {
        blocks.push({
          head: name,
          lines: [cells.slice(1).join(' | ')],
          fromTable: true,
          cells,
          header: tableHeader ?? undefined,
        });
      }
      continue;
    }

    const stripped = stripBullet(raw);
    if (!stripped.text) continue;

    // 带明确序号的卡片/列表：序号是动作边界，序号后的所有说明都归同一动作。
    // 不能再用“下一行没有组次数据”猜边界，否则动作要领会被切成伪动作。
    if (numberedMode) {
      if (stripped.index != null) {
        push();
        current = { head: stripped.text, lines: [] };
        fieldSeen = /(组|次|kg|公斤|休息|rpe|配速|心率|时间|距离|要领|注意)/i.test(stripped.text);
        continue;
      }
      if (!current) continue;
      const text = stripped.text;
      const compact = normalizeText(text).replace(/\s+/g, ' ').trim();
      const nextText = stripBullet(lines[lineIndex + 1] ?? '').text;
      const looksField = /(组|次|kg|公斤|休息|rpe|配速|心率|时间|距离|要领|注意)/i.test(text);
      const nextLooksField = /(组|次|kg|公斤|休息|rpe|配速|心率|时间|距离|要领|注意)/i.test(nextText);
      const inlineCut = compact.search(
        /(\d{1,2}\s*组|\d{1,2}\s*[x×*]\s*\d|@\s*\d|组数|次数|重量|休息|rpe|rir|配速|心率|距离|时长|时间\s*[:：]|要领|注意)/i,
      );
      const inlineName =
        inlineCut > 1 &&
        /[A-Za-z\u3400-\u9fff]/.test(compact.slice(0, inlineCut)) &&
        !/^(?:组间|组内|休息|间歇|组数|次数|重量|rpe|rir|动作要领|要领|注意|重点)/i.test(compact);
      const nextStartsAction =
        fieldSeen &&
        !looksField &&
        nextLooksField &&
        compact.length <= 60 &&
        !/^(?:组间|组内|休息|间歇|动作要领|要领|注意|重点|提示|说明|备注)/.test(compact);
      if (inlineName || nextStartsAction) {
        push();
        current = { head: text, lines: [], inferred: true };
        fieldSeen = looksField;
      } else {
        current.lines.push(text);
        if (looksField) fieldSeen = true;
      }
      continue;
    }

    const text = stripped.text;
    const looksField = /(组|次|kg|公斤|休息|rpe|配速|心率|时间|距离|要领|注意)/i.test(text);
    const isNumbered = stripped.index != null || /^[-*•·]/.test(normalizeText(raw).trim());
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
  const candidates = [block.head, ...block.lines]
    .map((line) => normalizeText(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let head =
    candidates.find(
      (line) =>
        !/^\d{1,2}(?:[.、)）])?$/.test(line) &&
        !FIELD_CUT.test(line) &&
        !parseDateLoose(line),
    ) ?? candidates[0] ?? '';
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

  // 表格：按表头列名取数（比正则更可靠）
  if (block.cells && block.header) {
    const header = block.header;
    const cells = block.cells;
    const cellOf = (names: string[]): string => {
      const i = header.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
      return i >= 0 && i < cells.length ? cells[i] : '';
    };
    const setsCell = cellOf(['组数', '组', 'sets']);
    const repsCell = cellOf(['次数', '次', 'reps']);
    const weightCell = cellOf(['重量', '负荷', '负重', 'weight', 'kg']);
    const restCell = cellOf(['休息', '间歇', 'rest']);
    const rpeCell = cellOf(['rpe', '强度']);
    const setsNum = setsCell ? firstNumber(setsCell) : null;
    if (setsNum != null) target.sets = setsNum;
    if (repsCell) target.reps = repsCell.replace(/[^\d\-–~力竭amrap]/gi, '') || target.reps;
    if (weightCell) {
      const w = parseTargetFromText(weightCell);
      if (w.weightKg != null) target.weightKg = w.weightKg;
      else if (w.weightText) target.weightText = w.weightText;
    }
    if (restCell) {
      const min = restCell.match(/(\d{1,3}(?:\.\d+)?)\s*(?:分钟|分|min|m\b)/i);
      const sec = restCell.match(/(\d{1,3}(?:\.\d+)?)\s*(?:秒|s\b|sec)/i);
      const bare = restCell.match(/^(\d{1,3})$/);
      if (min) target.restSec = Math.round(Number(min[1]) * 60);
      else if (sec) target.restSec = Math.round(Number(sec[1]));
      else if (bare) target.restSec = Number(bare[1]);
    }
    if (rpeCell) {
      const r = parseTargetFromText(rpeCell);
      const bare = rpeCell.trim().match(/^(\d{1,2}(?:\.\d+)?)/);
      if (r.rpe != null) target.rpe = r.rpe;
      else if (bare) target.rpe = Number(bare[1]);
    }
  }

  const cue = textFromLabel(block, CUE_LABELS) ?? looseCueLines(block)[0];
  const notes = textFromLabel(block, NOTE_LABELS) ?? (looseCueLines(block).slice(1).join('；') || undefined);

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
  const WARMUP_CUT =
    /(\d{1,3}\s*组|\d{1,3}\s*[x×*]\s*\d|@\s*\d|\d{1,3}\s*(?:kg|公斤|秒|分钟|分|米|公里)|心率|距离|配速|速度|时间\s*[:：])/i;
  for (const raw of lines) {
    const { text } = stripBullet(raw);
    if (!text) continue;
    const cells = tableCells(raw);
    const content = cells ? cells.join(' ') : text;
    const cut = content.search(WARMUP_CUT);
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
    if (/^\d/.test(t) && !/^\d{1,3}\s*(?:分钟|分|小时).*(?:计划|训练|课程)/.test(t)) continue;
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
    const source =
      hit?.value ??
      (/(?:预计|大约|约)?\s*\d{1,3}\s*(?:分钟|min|分)/i.test(line) &&
      !/\d+\s*组/.test(line) &&
      !/热身|拉伸|放松|收尾|整理活动|冷身|每组/.test(line)
        ? line
        : null);
    if (!source) continue;
    const range = source.match(/(\d{1,3})\s*[-–~到至]\s*(\d{1,3})/);
    if (range) return Number(range[2]);
    const single = source.match(/(?:约|大约|预计)?\s*(\d{1,3})\s*(?:分钟|min|分)/i);
    if (single) return Number(single[1]);
  }
  return null;
}

function looksLikeSectionHeading(line: string, keywords: string[]): boolean {
  const raw = normalizeText(line).replace(/^[#*\s]+/, '').trim();
  if (!raw || raw.includes(':') || raw.includes(',') || raw.includes('|')) return false;
  return keywords.some((keyword) => {
    if (!raw.startsWith(keyword)) return false;
    const rest = raw.slice(keyword.length).replace(/[（(].*?[）)]/g, '').trim();
    return !rest || /^(?:约)?\d{1,3}\s*(?:分钟|分|秒)$/.test(rest);
  });
}

/** 卡片 PDF 的页眉/页脚常带日期、总时长和“5个主动作”，不能当训练正文。 */
function isLikelyPageMeta(line: string): boolean {
  const text = normalizeText(line).trim();
  if (!text || text.length > 90 || !parseDateLoose(text)) return false;
  return /主动作|训练|计划|课表/.test(text) && /[/｜|·]/.test(text);
}

function declaredMainExerciseCount(text: string): number | null {
  const normalized = normalizeText(text);
  const hit =
    normalized.match(/(\d{1,2})\s*个主动作/) ??
    normalized.match(/主动作\s*[:：]?\s*(\d{1,2})\s*个/);
  return hit ? Number(hit[1]) : null;
}

function isSuspiciousExerciseName(name: string): boolean {
  const text = normalizeText(name).replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/^\d{1,2}(?:[.、)）])?$/.test(text)) return true;
  if (/^(?:总时长|主动作|强度|休息|热身|收尾|目标|说明|备注)(?:\s|$)/.test(text)) return true;
  if (/^(?:第?\d+\s*页|page\s*\d+)/i.test(text)) return true;
  if (parseDateLoose(text) && text.length <= 32) return true;
  if (/^(?:约)?\d+\s*(?:分钟|分|小时)(?:\d+\s*(?:个|组|次))?$/.test(text)) return true;
  if (/[/｜|]/.test(text) && parseDateLoose(text)) return true;
  if (text.length > 36 && /[，。；]/.test(text)) return true;
  if (!/[A-Za-z\u3400-\u9fff]/.test(text)) return true;
  return false;
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
  const contentLines = lines.filter((line) => !isLikelyPageMeta(line));
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
  const looksLikeExerciseLine = (line: string): boolean =>
    tableCells(line) !== null ||
    /\d{1,2}\s*组|[x×*]\s*\d{1,3}|\d+\s*(?:kg|公斤)|@\s*\d|组间休息|\d+\s*秒/.test(
      normalizeText(line),
    );
  const META_LABELS = ['日期', '计划日期', '预计训练时间', '预计时长', '总时长', '训练时长', '计划名称', '地点', '教练', '训练目标'];

  let current: Section = 'meta';
  for (let lineIndex = 0; lineIndex < contentLines.length; lineIndex += 1) {
    const line = contentLines[lineIndex];
    if (isHeading(line, WARMUP_HEADINGS) || looksLikeSectionHeading(line, WARMUP_HEADINGS)) {
      current = 'warmup';
      continue;
    }
    if (looksLikeSectionHeading(line, NOTE_HEADINGS) && !isHeading(line, MAIN_HEADINGS)) {
      current = 'notes';
      continue;
    }
    if (
      current !== 'warmup' &&
      (isHeading(line, COOLDOWN_HEADINGS) || looksLikeSectionHeading(line, COOLDOWN_HEADINGS)) &&
      !isHeading(line, MAIN_HEADINGS)
    ) {
      current = 'cooldown';
      continue;
    }
    if (isHeading(line, MAIN_HEADINGS, 9)) {
      current = 'main';
      continue;
    }
    const coolHit =
      current === 'main'
        ? matchLabel(line, ['拉伸放松', '拉伸与恢复', '拉伸恢复', '拉伸', '放松'], 'rest')
        : null;
    if (coolHit) {
      current = 'cooldown';
      sections.cooldown.push(`${coolHit.label}：${coolHit.value}`);
      continue;
    }

    if (current === 'meta' && matchLabel(line, META_LABELS, 'rest')) {
      sections.meta.push(line);
      continue;
    }
    // 单行热身：「热身：慢跑 5 分钟；动态拉伸 5 分钟」
    const warmHit = current === 'meta' ? matchLabel(line, ['热身内容', '热身安排', '热身', '准备活动'], 'rest') : null;
    if (warmHit) {
      for (const part of warmHit.value.split(/[;；]/)) {
        const t = part.trim();
        if (t) sections.warmup.push(t);
      }
      continue;
    }
    // 「备注：…」这类行归到计划备注，而不是当成动作要领
    const planNoteLabels = current === 'main' ? ['备注', '教练备注'] : ['备注', '注意事项', '说明', '提示', '教练备注'];
    const noteHit = current !== 'notes' ? matchLabel(line, planNoteLabels, 'rest') : null;
    if (noteHit) {
      sections.notes.push(`${noteHit.label}：${noteHit.value}`);
      continue;
    }
    if (current === 'meta' && looksLikeExerciseLine(line)) current = 'main';
    // 卡片式计划常常没有「正式训练」标题：热身段落之后，只有遇到带独立组次行的
    // 编号卡片才进入主动作；普通「1. 动态拉伸」仍留在热身，不能误切。
    const nextLine = contentLines[lineIndex + 1] ?? '';
    if (
      (current === 'warmup' || current === 'meta') &&
      /^\d{1,2}\s*[.、)）]\s+\S/.test(normalizeText(line)) &&
      !/热身|慢跑|快走|动态拉伸|激活|活动度/.test(normalizeText(line)) &&
      looksLikeExerciseLine(nextLine)
    ) {
      current = 'main';
    }
    sections[current].push(line);
  }

  const metaLines = sections.meta;
  const dateHit =
    [...metaLines, ...lines].map((l) => parseDateLoose(l)).find((d) => d) ??
    parseDateLoose(opts.fileName ?? '');
  const title = guessTitle(contentLines, opts.fileName);
  const estimatedMinutes = guessMinutes(contentLines);

  // 2. 热身
  let warmup = parseWarmupLines(sections.warmup);
  if (!warmup.length) {
    // 没有热身小节时，从 meta 里找「热身」开头的行
    const inline = contentLines.filter((l) => /^热身/.test(normalizeText(l)) && !isHeading(l, WARMUP_HEADINGS));
    if (inline.length) warmup = parseWarmupLines(inline);
  }

  // 3. 正式训练动作
  let mainLines = sections.main;
  if (!mainLines.length) {
    mainLines = contentLines.filter((l) => !metaLines.includes(l) && !sections.notes.includes(l) && !sections.cooldown.includes(l));
  }
  const blocks = splitExerciseBlocks(mainLines);
  const exercises: ExerciseItem[] = [];
  for (const b of blocks) {
    const ex = exerciseFromBlock(b, exercises.length, sessionKind);
    if (ex) exercises.push(ex);
  }
  // 没有目标数值、且名字像放松内容的块，归到拉伸恢复而不是动作
  const cooldownExtra: string[] = [];
  const keptExercises = exercises.filter((e) => {
    const noTarget =
      !e.target.sets && !e.target.reps && e.target.weightKg == null && !e.target.durationSec && !e.target.distanceKm;
    if (noTarget && /拉伸|放松|泡沫轴|冷身|整理活动|恢复/.test(e.name)) {
      cooldownExtra.push(e.cue ? `${e.name}：${e.cue}` : e.name);
      return false;
    }
    return true;
  });

  // 4. 拉伸 / 恢复 / 备注
  const cooldown = [...sections.cooldown, ...cooldownExtra].join('\n').trim();
  const notes = sections.notes.join('\n').trim();

  // 5. 置信度与提示：结构缺失、疑似噪声名称或标称动作数不一致时，不能继续显示高完整度。
  let score = 0;
  const total = 5;
  if (title && title !== '导入的训练计划') score += 1;
  if (dateHit) score += 1;
  if (warmup.length) score += 0.5;
  if (keptExercises.length) score += 1.5;
  if (keptExercises.some((e) => e.target.sets && e.target.reps)) score += 1;
  let confidence = Math.max(0.1, Math.min(1, score / total));

  if (!keptExercises.length) warnings.push('没有识别到训练动作，请手动添加，或确认 PDF 是否为文字型文件。');
  if (!dateHit) warnings.push('未识别到训练日期，已默认使用今天，可手动修改。');

  const hasInferredBlocks = blocks.some((block) => block.inferred);
  if (hasInferredBlocks) {
    warnings.push('检测到无编号或混合编号的动作段落，已按组次行推断边界，请核对是否漏项或合并。');
    confidence = Math.min(confidence, 0.85);
  }

  const suspicious = keptExercises.filter((e) => isSuspiciousExerciseName(e.name));
  if (suspicious.length) {
    warnings.push(
      `有 ${suspicious.length} 个动作名称可能是序号、页眉或说明文字，请核对后再保存。`,
    );
    confidence = Math.min(confidence, 0.45);
  }

  const noTargets = keptExercises.filter(
    (e) => e.target.sets == null && e.target.reps == null && !e.target.durationSec && !e.target.distanceKm,
  );
  if (noTargets.length) {
    warnings.push(`有 ${noTargets.length} 个动作未识别到组数/次数或训练时长，请手动补全。`);
    confidence = Math.min(confidence, 0.65);
  }
  if (keptExercises.length > 0 && keptExercises.length < 2) {
    warnings.push('只识别到 1 个动作，请检查 PDF 排版是否为多列。');
    confidence = Math.min(confidence, 0.6);
  }

  const declaredCount = declaredMainExerciseCount(text);
  if (declaredCount != null && declaredCount !== keptExercises.length) {
    warnings.push(
      `文件标称 ${declaredCount} 个主动作，但当前识别到 ${keptExercises.length} 个，请核对动作是否完整。`,
    );
    confidence = Math.min(confidence, 0.5);
  }

  const targetLineCount = mainLines.filter((line) =>
    /(\d{1,2}\s*组|\d{1,2}\s*[x×*]\s*\d)/.test(normalizeText(line)),
  ).length;
  if (targetLineCount > keptExercises.length && targetLineCount >= 2) {
    warnings.push(
      `检测到 ${targetLineCount} 条组次/时长目标，但只整理出 ${keptExercises.length} 个动作，请重点核对是否合并或漏项。`,
    );
    confidence = Math.min(confidence, 0.6);
  }

  return {
    title,
    date: dateHit,
    sessionKind,
    estimatedMinutes,
    warmup,
    exercises: keptExercises,
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
      const label = t.slice(0, 22).replace(/[:：\s]+$/, '');
      current = { title: label, lines: [t] };
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
