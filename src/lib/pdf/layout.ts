/**
 * 把 pdf.js 的 textContent items 还原成「按视觉行排列的文字」。
 * 纯函数，方便用合成数据做单元测试。
 */
import { needsSpace } from './text';

export interface TextItemLike {
  str: string;
  /** pdf.js: [a, b, c, d, e, f]，e= x, f = y（原点左下） */
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface Piece {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

/** 同一行的纵向容差（pt） */
const LINE_TOLERANCE = 3.2;

interface VisualLine {
  y: number;
  pieces: Piece[];
}

interface Region {
  anchorY: number;
  x: number;
  lines: string[];
}

function mergeLine(group: Piece[]): string {
  const ordered = [...group].sort((a, b) => a.x - b.x);
  let text = '';
  let prevEnd: number | null = null;
  for (const p of ordered) {
    if (prevEnd != null) {
      const gap = p.x - prevEnd;
      const charW = p.width > 0 && p.str.length > 0 ? p.width / p.str.length : 6;
      // 有可见空隙且两侧都是英文/数字时补空格；中文之间不补
      if (gap > charW * 0.35 && needsSpace(text, p.str)) text += ' ';
    }
    text += p.str;
    prevEnd = p.x + p.width;
  }
  return text.replace(/\s+/g, ' ').trim();
}

function groupVisualLines(pieces: Piece[]): VisualLine[] {
  if (!pieces.length) return [];
  // 按 y 从大到小（页面自上而下）分组
  const sorted = [...pieces].sort((a, b) =>
    Math.abs(b.y - a.y) > LINE_TOLERANCE ? b.y - a.y : a.x - b.x,
  );
  const groups: Piece[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].y - p.y) <= LINE_TOLERANCE) last.push(p);
    else groups.push([p]);
  }
  return groups.map((group) => ({
    y: Math.max(...group.map((p) => p.y)),
    pieces: group,
  }));
}

/**
 * 卡片式计划常把大号序号放在正文左侧，序号基线可能晚于标题。
 * 先按序号和邻近正文聚成卡片，再把序号重新拼到标题前，避免把
 * “1 / 2 / 3” 当成独立动作，也避免多列文字被 y 轴排序串行。
 */
function cardRegions(pieces: Piece[]): { regions: Region[]; consumed: Set<Piece> } {
  const consumed = new Set<Piece>();
  const regions: Region[] = [];
  const markers = pieces.filter((p) => /^\d{1,2}$/.test(p.str.trim()));
  if (markers.length < 2) return { regions, consumed };

  const columns: Piece[][] = [];
  for (const marker of markers.sort((a, b) => a.x - b.x || b.y - a.y)) {
    const column = columns.find((col) => Math.abs(col[0].x - marker.x) <= 18);
    if (column) column.push(marker);
    else columns.push([marker]);
  }

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    if (column.length < 2) continue;
    const nextColumn = columns[columnIndex + 1];
    const columnRight = nextColumn ? Math.min(...nextColumn.map((p) => p.x)) - 4 : Infinity;
    const ordered = [...column].sort((a, b) => b.y - a.y);
    for (let i = 0; i < ordered.length; i += 1) {
      const marker = ordered[i];
      const nextMarker = ordered[i + 1];
      const top = marker.y + 42;
      const bottom = nextMarker ? (marker.y + nextMarker.y) / 2 : marker.y - 45;
      const body = pieces.filter(
        (p) =>
          !consumed.has(p) &&
          p !== marker &&
          p.x > marker.x + 4 &&
          p.x < columnRight &&
          p.y <= top &&
          p.y > bottom,
      );
      if (!body.length) continue;

      const content = groupVisualLines(body).map((line) => mergeLine(line.pieces));
      const markerText = marker.str.trim().replace(/[.、)）:：]+$/, '');
      if (content[0] && !content[0].startsWith(`${markerText}.`)) {
        content[0] = `${markerText}. ${content[0]}`;
      }
      body.forEach((p) => consumed.add(p));
      consumed.add(marker);
      regions.push({
        anchorY: Math.max(...body.map((p) => p.y)),
        x: Math.min(marker.x, ...body.map((p) => p.x)),
        lines: content.filter(Boolean),
      });
    }
  }
  return { regions, consumed };
}

export function itemsToLines(items: TextItemLike[]): string[] {
  const pieces: Piece[] = [];
  items.forEach((it, index) => {
    const str = it.str ?? '';
    if (!str.trim()) return;
    const x = Number(it.transform?.[4] ?? 0);
    const y = Number(it.transform?.[5] ?? 0);
    const height = Number(it.height ?? 10);
    const width = Number(it.width ?? str.length * height * 0.5);
    pieces.push({ str, x, y, width, height, index });
  });
  if (!pieces.length) return [];

  const cards = cardRegions(pieces);
  const regions: Region[] = [...cards.regions];
  for (const line of groupVisualLines(pieces.filter((p) => !cards.consumed.has(p)))) {
    const text = mergeLine(line.pieces);
    if (!text) continue;
    regions.push({
      anchorY: line.y,
      x: Math.min(...line.pieces.map((p) => p.x)),
      lines: [text],
    });
  }
  regions.sort((a, b) => b.anchorY - a.anchorY || a.x - b.x);
  return regions.flatMap((region) => region.lines).filter((line) => line.length > 0);
}

/** 页与页之间用换行拼接 */
export function pagesToText(pages: string[]): string {
  return pages.map((p) => p.trim()).filter(Boolean).join('\n');
}
