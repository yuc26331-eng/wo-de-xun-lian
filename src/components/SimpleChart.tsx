/**
 * 轻量 SVG 图表（无第三方依赖，深浅色自适应，iPhone 宽度自适应）
 * 用于数据页趋势：折线 / 柱状 / 训练日历
 */
import type { ReactNode } from 'react';
import { formatNumber } from '../lib/format';

export interface ChartPoint {
  label: string;
  value: number;
}

function niceBounds(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

export function LineChart({
  points,
  unit,
  height = 150,
  tone = 'var(--accent)',
  showDots = true,
  summary,
}: {
  points: ChartPoint[];
  unit?: string;
  height?: number;
  tone?: string;
  showDots?: boolean;
  summary?: ReactNode;
}) {
  if (points.length === 0) {
    return (
      <div className="chart-empty">
        <span className="muted small">还没有数据</span>
      </div>
    );
  }

  const width = 320;
  const padX = 6;
  const padTop = 12;
  const padBottom = 22;
  const values = points.map((p) => p.value);
  const { min, max } = niceBounds(values);
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : padX + (i * innerW) / (points.length - 1);
  const y = (v: number) => padTop + innerH - ((v - min) / (max - min)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padTop + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const first = points[0];
  const firstLabel = points.length > 2 ? first.label : '';
  const midLabel = points.length > 2 ? points[Math.floor(points.length / 2)].label : '';

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`趋势图，最新 ${formatNumber(last.value)}${unit ?? ''}`}>
        <defs>
          <linearGradient id={`grad-${tone.replace(/[^a-z]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#grad-${tone.replace(/[^a-z]/gi, '')})`} />
        <path d={line} fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {showDots &&
          points.map((p, i) => (
            <circle key={`${p.label}-${i}`} cx={x(i)} cy={y(p.value)} r={points.length > 20 ? 1.6 : 2.6} fill={tone} />
          ))}
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.4" fill="var(--card)" stroke={tone} strokeWidth="2.4" />
        {firstLabel && (
          <text x={padX} y={height - 6} fontSize="10" fill="var(--muted)">
            {firstLabel}
          </text>
        )}
        {midLabel && (
          <text x={width / 2} y={height - 6} fontSize="10" fill="var(--muted)" textAnchor="middle">
            {midLabel}
          </text>
        )}
        <text x={width - padX} y={height - 6} fontSize="10" fill="var(--muted)" textAnchor="end">
          {last.label}
        </text>
      </svg>
      {summary && <div className="chart-summary">{summary}</div>}
    </div>
  );
}

export function BarChart({
  points,
  unit,
  height = 150,
  tone = 'var(--accent)',
}: {
  points: ChartPoint[];
  unit?: string;
  height?: number;
  tone?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="chart-empty">
        <span className="muted small">还没有数据</span>
      </div>
    );
  }
  const width = 320;
  const padTop = 12;
  const padBottom = 22;
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerH = height - padTop - padBottom;
  const n = points.length;
  const slot = (width - 12) / n;
  // 数据点很少时把柱子画粗并居中，避免「一根细线飘在大片空白里」
  const maxBarW = n === 1 ? 68 : n <= 3 ? 46 : n <= 8 ? 26 : 18;
  const barW = Math.max(2, Math.min(maxBarW, slot * 0.62));
  const last = points[n - 1];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`柱状图，最新 ${formatNumber(last.value)}${unit ?? ''}`}>
        {points.map((p, i) => {
          const h = (p.value / max) * innerH;
          const bx = 6 + i * slot + (slot - barW) / 2;
          return (
            <rect
              key={`${p.label}-${i}`}
              x={bx}
              y={padTop + innerH - h}
              width={barW}
              height={Math.max(h, p.value > 0 ? 2 : 0)}
              rx={Math.min(6, barW / 2)}
              fill={i === n - 1 ? tone : 'var(--card-2)'}
            />
          );
        })}
        <text
          x={n === 1 ? width / 2 : 6}
          y={height - 6}
          fontSize="10"
          fill="var(--muted)"
          textAnchor={n === 1 ? 'middle' : 'start'}
        >
          {points[0].label}
        </text>
        {n > 1 && (
          <text x={width - 6} y={height - 6} fontSize="10" fill="var(--muted)" textAnchor="end">
            {last.label}
          </text>
        )}
        <text x={width / 2} y={padTop - 1} fontSize="10" fill="var(--muted)" textAnchor="middle">
          {n === 1 ? `本次 ${formatNumber(last.value)}` : '最大 '}
          {n === 1 ? (unit ?? '') : `${formatNumber(max)}${unit ?? ''}`}
        </text>
      </svg>
    </div>
  );
}

export function CalendarGrid({
  month,
  trainedDates,
  selected,
  onSelect,
}: {
  /** 'YYYY-MM' */
  month: string;
  trainedDates: Set<string>;
  selected?: string | null;
  onSelect?: (date: string) => void;
}) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leading = first.getDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      return `${year}-${`${monthIndex + 1}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`;
    }),
  ];
  const weekday = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="cal">
      <div className="cal-head">
        {weekday.map((w) => (
          <span key={w} className="tiny muted">
            {w}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} />;
          const day = Number(date.slice(-2));
          const trained = trainedDates.has(date);
          return (
            <button
              key={date}
              className={`cal-cell ${trained ? 'trained' : ''} ${selected === date ? 'selected' : ''}`}
              onClick={() => onSelect?.(date)}
              aria-label={`${date}${trained ? ' 已训练' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
