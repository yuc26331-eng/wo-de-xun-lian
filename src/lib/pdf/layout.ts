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
}

/** 同一行的纵向容差（pt） */
const LINE_TOLERANCE = 3.2;

export function itemsToLines(items: TextItemLike[]): string[] {
  const pieces: Piece[] = [];
  for (const it of items) {
    const str = it.str ?? '';
    if (!str.trim()) continue;
    const x = Number(it.transform?.[4] ?? 0);
    const y = Number(it.transform?.[5] ?? 0);
    const width = Number(it.width ?? str.length * (it.height ?? 10) * 0.5);
    pieces.push({ str, x, y, width });
  }
  if (!pieces.length) return [];

  // 按 y 从大到小（页面自上而下）分组
  const sorted = [...pieces].sort((a, b) => (Math.abs(b.y - a.y) > LINE_TOLERANCE ? b.y - a.y : a.x - b.x));
  const lines: Piece[][] = [];
  for (const p of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - p.y) <= LINE_TOLERANCE) last.push(p);
    else lines.push([p]);
  }

  return lines
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd: number | null = null;
      for (const p of ordered) {
        if (prevEnd != null) {
          const gap = p.x - prevEnd;
          const charW = p.width > 0 && p.str.length > 0 ? p.width / p.str.length : 6;
          // 明显断开时补空格，接近连续时不补
          if (gap > charW * 0.9 && needsSpace(text, p.str)) text += ' ';
        }
        text += p.str;
        prevEnd = p.x + p.width;
      }
      return text.replace(/\s+/g, ' ').trim();
    })
    .filter((l) => l.length > 0);
}

/** 页与页之间用换行拼接 */
export function pagesToText(pages: string[]): string {
  return pages.map((p) => p.trim()).filter(Boolean).join('\n');
}
