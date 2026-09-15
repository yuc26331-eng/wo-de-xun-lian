/**
 * 历史报告导入的写入流程
 *
 * 顺序：备份 → 取包解密 → 逐天合并写入（每日总结 / 训练记录 / 原始 PDF 附件）
 * 写入全部走 AppData 里已有的持久化接口（IndexedDB），刷新、退出、离线都在。
 * 接口通过 target 注入，方便单元测试用假实现验证顺序与合并规则。
 */
import type { AttachmentMeta, BackupSnapshot, DailyLog, ISODate, WorkoutSummary } from '../../types';
import { loadHistoryBundle, type LoadBundleOptions } from './historyBundle';
import {
  mapHistoryDay,
  mergeDailyLog,
  type FieldConflict,
  type MappedHistoryDay,
} from './historyMap';

export interface HistoryImportTarget {
  /** 读取某天已有的每日总结（直接查库，避免用到过期的内存缓存） */
  getDailyLog: (date: ISODate) => Promise<DailyLog | null>;
  createBackupSnapshot: (reason: string) => Promise<BackupSnapshot>;
  saveDailyLog: (patch: Partial<DailyLog> & { date: ISODate }) => Promise<DailyLog>;
  saveAttachment: (meta: AttachmentMeta, blob: Blob) => Promise<void>;
  saveSummary: (summary: WorkoutSummary) => Promise<void>;
}

export type HistoryImportStage = 'download' | 'decrypt' | 'backup' | 'write' | 'done';

export interface HistoryImportProgress {
  stage: HistoryImportStage;
  /** 写入阶段：已处理天数 */
  current: number;
  total: number;
  label: string;
}

export interface HistoryImportDayResult {
  date: ISODate;
  status: 'created' | 'merged' | 'unchanged';
  imported: string[];
  warnings: string[];
  conflicts: FieldConflict[];
  fills: string[];
  summaries: number;
  hasPdf: boolean;
}

export interface HistoryImportResult {
  days: HistoryImportDayResult[];
  created: number;
  merged: number;
  unchanged: number;
  conflicts: FieldConflict[];
  warnings: string[];
  attachmentCount: number;
  summaryCount: number;
  backupId: string | null;
  dateStart: ISODate;
  dateEnd: ISODate;
}

export interface HistoryImportOptions extends LoadBundleOptions {
  onProgress?: (p: HistoryImportProgress) => void;
  /** 测试或特殊场景下跳过自动备份（默认不跳过） */
  skipBackup?: boolean;
  /**
   * 解密成功之后、真正写入之前执行（例如首次使用时的一次性数据清理）。
   * 放在解密之后，保证"导入码不对"时不会动到任何已有数据。
   */
  beforeWrite?: () => Promise<void>;
  now?: string;
}

/** base64 → Blob（分块处理，避免大文件把主线程卡住） */
export function base64ToBlob(b64: string, type = 'application/pdf'): Blob {
  const clean = b64.replace(/\s+/g, '');
  const chunk = 1024;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < clean.length; i += chunk) {
    const slice = clean.slice(i, i + chunk);
    const bin = atob(slice);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j += 1) bytes[j] = bin.charCodeAt(j);
    parts.push(bytes);
  }
  return new Blob(parts as unknown as BlobPart[], { type });
}

/**
 * 执行导入：把导入包里的每一天写成正式的每日记录 / 训练记录 / 附件。
 * 同一天已有记录时只补空字段并列出冲突，不覆盖、不产生重复条目。
 */
export async function importHistoryBundle(
  code: string,
  target: HistoryImportTarget,
  options: HistoryImportOptions = {},
): Promise<HistoryImportResult> {
  const now = options.now ?? new Date().toISOString();
  const report = (stage: HistoryImportStage, current: number, total: number, label: string) =>
    options.onProgress?.({ stage, current, total, label });

  report('download', 0, 1, '正在获取历史数据包…');
  const { meta, bundle } = await loadHistoryBundle(code, options);

  report('decrypt', 1, 1, '导入码验证通过，正在校验内容…');

  if (options.beforeWrite) {
    await options.beforeWrite();
  }

  let backupId: string | null = null;
  if (!options.skipBackup) {
    report('backup', 0, 1, '正在备份当前数据…');
    const snapshot = await target.createBackupSnapshot('导入历史报告前自动备份');
    backupId = snapshot.id;
  }

  const mapped: MappedHistoryDay[] = bundle.days
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((day) => mapHistoryDay(day, now));

  const results: HistoryImportDayResult[] = [];
  let attachmentCount = 0;
  let summaryCount = 0;
  let index = 0;

  for (const item of mapped) {
    index += 1;
    report('write', index, mapped.length, `正在写入 ${item.date}（${index}/${mapped.length}）…`);
    const existing = await target.getDailyLog(item.date);
    const merged = mergeDailyLog(item.log, existing, now);
    const reportsBefore = existing?.reportImports?.length ?? 0;
    const reportsAfter = merged.log.reportImports?.length ?? 0;
    const changed =
      !existing ||
      merged.fills.length > 0 ||
      reportsAfter > reportsBefore ||
      (item.attachment != null && !(existing.attachmentIds ?? []).includes(item.attachment.id));

    if (changed) {
      await target.saveDailyLog(merged.log);
      if (item.attachment) {
        await target.saveAttachment(
          item.attachment.meta,
          base64ToBlob(item.attachment.base64, item.attachment.meta.type),
        );
        attachmentCount += 1;
      }
      for (const summary of item.summaries) {
        await target.saveSummary(summary);
        summaryCount += 1;
      }
    }

    results.push({
      date: item.date,
      status: !existing ? 'created' : changed ? 'merged' : 'unchanged',
      imported: item.imported,
      warnings: item.warnings,
      conflicts: merged.conflicts,
      fills: merged.fills,
      summaries: item.summaries.length,
      hasPdf: item.attachment != null,
    });
  }

  const conflicts = results.flatMap((r) => r.conflicts);
  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.date}：${w}`));

  report('done', mapped.length, mapped.length, '导入完成');

  return {
    days: results,
    created: results.filter((r) => r.status === 'created').length,
    merged: results.filter((r) => r.status === 'merged').length,
    unchanged: results.filter((r) => r.status === 'unchanged').length,
    conflicts,
    warnings,
    attachmentCount,
    summaryCount,
    backupId,
    dateStart: meta.dateStart,
    dateEnd: meta.dateEnd,
  };
}
