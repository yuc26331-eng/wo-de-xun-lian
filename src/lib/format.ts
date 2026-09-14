import type { ISODate, SessionKind, TargetSpec } from '../types';

export function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix ? `${prefix}_${rnd}` : rnd;
}

/** 本地时区的 YYYY-MM-DD，避免 UTC 偏移导致日期错一天 */
export function toISODate(d: Date = new Date()): ISODate {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function parseISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatDateCN(date: ISODate | null | undefined): string {
  if (!date) return '未设置日期';
  const d = parseISODate(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateShort(date: ISODate | null | undefined): string {
  if (!date) return '—';
  const d = parseISODate(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function dayLabel(date: ISODate): string {
  const today = toISODate();
  const diff = dayDiff(date, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === -1) return '明天';
  const d = parseISODate(date);
  return WEEKDAY[d.getDay()];
}

/** a - b 的天数差 */
export function dayDiff(a: ISODate, b: ISODate): number {
  const da = parseISODate(a).getTime();
  const db = parseISODate(b).getTime();
  return Math.round((da - db) / 86400000);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** 秒 -> 1:05:09 / 12:30 */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${`${m}`.padStart(2, '0')}:${`${sec}`.padStart(2, '0')}`;
  return `${m}:${`${sec}`.padStart(2, '0')}`;
}

/** 秒 -> 1小时5分 / 45分钟 */
export function formatDurationCN(totalSec: number | null | undefined): string {
  if (totalSec == null || !isFinite(totalSec)) return '—';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  if (m > 0) return `${m}分钟`;
  return `${s}秒`;
}

/** 秒 -> 45分30秒 */
export function formatMinSec(totalSec: number | null | undefined): string {
  if (totalSec == null || !isFinite(totalSec)) return '—';
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}秒`;
  return sec === 0 ? `${m}分` : `${m}分${sec}秒`;
}

export function formatNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '—';
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(digits);
}

export function formatVolume(kg: number | null | undefined): string {
  if (kg == null || !isFinite(kg) || kg <= 0) return '—';
  if (kg >= 10000) return `${(kg / 1000).toFixed(1)} 吨`;
  return `${Math.round(kg)} kg`;
}

/** 配速文字 5'30"/km */
export function formatPace(distanceKm: number | null, durationSec: number | null): string {
  if (!distanceKm || !durationSec || distanceKm <= 0) return '—';
  const secPerKm = durationSec / distanceKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${`${s}`.padStart(2, '0')}"/km`;
}

export function paceToSecPerKm(paceText: string | null | undefined): number | null {
  if (!paceText) return null;
  const m = paceText.match(/(\d{1,2})\s*['′:：]\s*(\d{1,2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const m2 = paceText.match(/(\d{1,2}(?:\.\d+)?)\s*(?:km\/h|公里\/小时)/i);
  if (m2) return Math.round(3600 / Number(m2[1]));
  return null;
}

/** 秒 -> '5:30' */
export function secPerKmToText(secPerKm: number | null): string {
  if (secPerKm == null || !isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${`${s}`.padStart(2, '0')}`;
}

export function mmssToMinSec(text: string): { minutes: number; seconds: number } | null {
  const m = text.match(/^(\d{1,3})\s*[:：]\s*(\d{1,2})$/);
  if (!m) return null;
  return { minutes: Number(m[1]), seconds: Number(m[2]) };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 目标摘要：'3组 × 10次 · 60kg · 休息90秒' */
export function targetSummary(t: TargetSpec): string {
  const parts: string[] = [];
  if (t.sets) parts.push(`${t.sets}组`);
  if (t.reps) parts.push(`× ${t.reps}次`);
  if (t.weightKg != null) parts.push(`${formatNumber(t.weightKg)}kg`);
  else if (t.weightText) parts.push(t.weightText);
  if (t.durationSec) parts.push(formatMinSec(t.durationSec));
  if (t.distanceKm) parts.push(`${formatNumber(t.distanceKm, 2)}km`);
  if (t.paceText) parts.push(t.paceText);
  if (t.speedKph) parts.push(`${formatNumber(t.speedKph)}km/h`);
  if (t.hrBpm) parts.push(`心率${t.hrBpm}`);
  if (t.playMin) parts.push(`${t.playMin}分钟`);
  if (t.rpe != null) parts.push(`RPE ${t.rpe}`);
  if (t.rpeText) parts.push(t.rpeText);
  return parts.length ? parts.join(' · ') : '按感觉完成';
}

export const KIND_EMOJI: Record<SessionKind, string> = {
  strength: '🏋️',
  run: '🏃',
  ride: '🚴',
  football: '⚽',
  stretch: '🧘',
  recovery: '💤',
  other: '🎯',
};

export function kindIsCardio(kind: SessionKind): boolean {
  return kind === 'run' || kind === 'ride' || kind === 'football';
}

export function safeNum(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : null;
}
