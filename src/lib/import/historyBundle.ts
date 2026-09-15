/**
 * 历史报告导入包（网站公开仓库里只放密文）
 *
 * 背景：站点是公开的 GitHub Pages，用户的历史训练/睡眠/补剂数据不能明文进仓库。
 * 因此服务器上只放：
 *   - import/history.json：元数据（算法、盐、IV、日期范围，不含任何健康数据）
 *   - import/history.bin ：AES-256-GCM 密文（PBKDF2-SHA256 派生密钥）
 * 用户在自己设备上输入一次导入码，浏览器本地解密后写入 IndexedDB。
 *
 * 这里只做「取包 + 解密 + 结构校验」，不写任何数据；写入在 historyImport.ts。
 */
import type { ISODate } from '../../types';

export const HISTORY_META_PATH = 'import/history.json';
export const HISTORY_META_KIND = 'history-import';

export interface HistoryBundleMeta {
  app: string;
  kind: string;
  version: number;
  algorithm: string;
  kdf: string;
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  file: string;
  days: number;
  dateStart: ISODate;
  dateEnd: ISODate;
  generatedAt: string;
  note?: string;
}

export interface HistorySession {
  name: string;
  kind?: string;
  durationMin?: number | null;
  distanceKm?: number | null;
  kcal?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  rpe?: number | null;
  pace?: string;
  note?: string;
}

export interface HistoryTraining {
  items?: string;
  exercises?: string;
  sessionCount?: number | null;
  sessionDurationsMin?: (number | null)[];
  rpe?: number | null;
  matchPerformance?: string;
  completionPct?: number | null;
  restDay?: boolean;
  painSites?: string[];
  sessions?: HistorySession[];
}

export interface HistoryWatch {
  activeEnergyKcal?: number | null;
  totalEnergyKcal?: number | null;
  steps?: number | null;
  exerciseMinutes?: number | null;
  standHours?: number | null;
  distanceKm?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  restingHr?: number | null;
  hrRecovery?: number | null;
  hrvMs?: number | null;
  bloodOxygenPct?: number | null;
  note?: string;
}

export interface HistorySleep {
  bedTime?: string;
  sleepTime?: string;
  wakeTime?: string;
  totalHours?: number | null;
  deepHours?: number | null;
  coreHours?: number | null;
  remHours?: number | null;
  awakeHours?: number | null;
  napMinutes?: number | null;
  quality?: number | null;
  note?: string;
}

export interface HistorySupplements {
  proteinCups?: number | null;
  proteinG?: number | null;
  proteinScoops?: number | null;
  creatineCups?: number | null;
  creatineG?: number | null;
  caffeineCups?: number | null;
  caffeineMg?: number | null;
  creatineNone?: boolean;
  caffeineNote?: string;
  noneTaken?: boolean;
  others?: string;
  note?: string;
}

export interface HistoryMeals {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  snack?: string;
  waterMl?: number | null;
  note?: string;
}

export interface HistoryBundleDay {
  date: ISODate;
  file: string;
  title: string;
  training?: HistoryTraining;
  watch?: HistoryWatch;
  sleep?: HistorySleep;
  supplements?: HistorySupplements;
  meals?: HistoryMeals;
  /** 报告里的评分项（键为内部标识） */
  scores?: Record<string, number>;
  /** 评分项的自定义中文名（报告里项目名不固定时使用） */
  scoreLabels?: Record<string, string>;
  fatigue10?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  hrv_ms?: number | null;
  resting_hr?: number | null;
  note?: string;
  reportText?: string;
  pdfBase64?: string;
  pdfSize?: number;
}

export interface HistoryBundle {
  app: string;
  kind: string;
  version: number;
  generatedAt: string;
  days: HistoryBundleDay[];
}

export type HistoryImportErrorCode =
  | 'network'
  | 'bad-code'
  | 'corrupt'
  | 'unsupported'
  | 'no-crypto';

export class HistoryImportError extends Error {
  code: HistoryImportErrorCode;

  constructor(code: HistoryImportErrorCode, message: string) {
    super(message);
    this.name = 'HistoryImportError';
    this.code = code;
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 去掉分隔符、统一大写（用户手输时常见小写和空格） */
export function normalizeImportCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 展示用的分组形式：XXXX-XXXX-XXXX */
export function formatImportCode(input: string): string {
  const raw = normalizeImportCode(input);
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}

export function isImportCodeShape(input: string): boolean {
  return normalizeImportCode(input).length >= 8;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 生成包内文件的完整地址（考虑 GitHub Pages 子路径） */
export function bundleAssetUrl(path: string, baseUrl?: string): string {
  const base = baseUrl ?? import.meta.env.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\/+/, '')}`;
}

function assertMeta(value: unknown): HistoryBundleMeta {
  const meta = value as HistoryBundleMeta | null;
  if (!meta || typeof meta !== 'object' || meta.app !== 'wo-de-xun-lian') {
    throw new HistoryImportError('unsupported', '这不是「我的训练」的历史导入包');
  }
  if (meta.kind !== HISTORY_META_KIND || meta.version !== 1) {
    throw new HistoryImportError('unsupported', '导入包版本不受支持，请更新应用后重试');
  }
  if (!meta.salt || !meta.iv || !meta.file || !Number.isFinite(meta.iterations)) {
    throw new HistoryImportError('corrupt', '导入包元数据不完整');
  }
  return meta;
}

/** 结构校验：只要有一天日期不合法就整体拒绝，避免写入错日期的数据 */
function assertBundle(value: unknown): HistoryBundle {
  const bundle = value as HistoryBundle | null;
  if (!bundle || typeof bundle !== 'object' || bundle.app !== 'wo-de-xun-lian') {
    throw new HistoryImportError('corrupt', '导入包内容无法识别');
  }
  if (!Array.isArray(bundle.days) || bundle.days.length === 0) {
    throw new HistoryImportError('corrupt', '导入包里没有任何日期数据');
  }
  for (const day of bundle.days) {
    const date = typeof day?.date === 'string' ? day.date.trim() : '';
    if (!ISO_DATE_RE.test(date)) {
      throw new HistoryImportError('corrupt', `导入包里存在无法识别的日期：${String(day?.date)}`);
    }
  }
  return bundle;
}

/** 用导入码派生密钥（PBKDF2-SHA256）并解密 AES-256-GCM 密文 */
export async function decryptHistoryBundle(
  meta: HistoryBundleMeta,
  ciphertext: Uint8Array,
  code: string,
): Promise<HistoryBundle> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HistoryImportError('no-crypto', '当前浏览器不支持本地解密，请用 Safari 或 Chrome 打开');
  }
  const normalized = normalizeImportCode(code);
  if (!normalized) throw new HistoryImportError('bad-code', '请输入导入码');

  const salt = base64ToBytes(meta.salt);
  const iv = base64ToBytes(meta.iv);
  const iterations = Math.min(Math.max(Math.round(meta.iterations) || 1, 1000), 1_000_000);
  // 正常情况下双方都用「去掉分隔符、统一大写」的形式；这里额外容忍带分隔符的历史写法
  const candidates = Array.from(new Set([normalized, code.trim().toUpperCase()].filter(Boolean)));

  let plain: ArrayBuffer | null = null;
  for (const candidate of candidates) {
    try {
      const baseKey = await subtle.importKey(
        'raw',
        new TextEncoder().encode(candidate),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const key = await subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt as unknown as BufferSource,
          iterations,
          hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      );
      plain = await subtle.decrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        key,
        ciphertext as unknown as BufferSource,
      );
      break;
    } catch (err) {
      if (err instanceof HistoryImportError) throw err;
      // GCM 校验失败：几乎总是导入码不对，换下一个写法再试
      plain = null;
    }
  }
  if (!plain) {
    throw new HistoryImportError('bad-code', '导入码不正确，请确认后重新输入');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new HistoryImportError('corrupt', '导入包内容已损坏');
  }
  return assertBundle(parsed);
}

export interface LoadBundleOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchHistoryBundleMeta(
  options: LoadBundleOptions = {},
): Promise<HistoryBundleMeta> {
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(bundleAssetUrl(HISTORY_META_PATH, options.baseUrl), {
      cache: 'no-store',
    });
  } catch {
    throw new HistoryImportError('network', '当前无法连接网络，暂时不能检查历史导入包');
  }
  if (!res.ok) {
    throw new HistoryImportError('network', `读取导入包失败（HTTP ${res.status}）`);
  }
  return assertMeta(await res.json());
}

export async function fetchHistoryBundleCipher(
  meta: HistoryBundleMeta,
  options: LoadBundleOptions = {},
): Promise<Uint8Array> {
  const doFetch = options.fetchImpl ?? fetch;
  // meta.file 是相对导入包目录的文件名（例如 history.bin），
  // 只取文件名，避免出现 ../ 之类的路径，并保证和 history.json 同目录。
  const fileName = meta.file.split(/[\\/]/).pop() ?? meta.file;
  const dir = HISTORY_META_PATH.replace(/[^/]*$/, '');
  const url = bundleAssetUrl(`${dir}${fileName}`, options.baseUrl);
  let res: Response;
  try {
    res = await doFetch(url, { cache: 'no-cache' });
  } catch {
    throw new HistoryImportError('network', '下载历史数据包失败，请检查网络后重试');
  }
  if (!res.ok) {
    throw new HistoryImportError('network', `下载历史数据包失败（HTTP ${res.status}）`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new HistoryImportError('corrupt', '历史数据包是空的，请稍后重试');
  }
  return buf;
}

/** 取包 → 解密 → 结构校验 */
export async function loadHistoryBundle(
  code: string,
  options: LoadBundleOptions = {},
): Promise<{ meta: HistoryBundleMeta; bundle: HistoryBundle }> {
  const meta = await fetchHistoryBundleMeta(options);
  const cipher = await fetchHistoryBundleCipher(meta, options);
  const bundle = await decryptHistoryBundle(meta, cipher, code);
  return { meta, bundle };
}
