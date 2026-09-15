/**
 * 历史报告导入页（今日总结 → 我的每日记录 → 导入历史报告）
 *
 * 为什么需要导入码：站点是公开的 GitHub Pages，历史报告里包含训练/睡眠/补剂等健康数据，
 * 明文放进仓库等于公开。因此服务器上只有加密包，导入码只在用户自己设备上输入一次，
 * 浏览器本地解密后写入本机 IndexedDB（不上传任何数据）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { Bar, Button, Card, Chip, Field, SectionTitle, TextInput, useToast } from '../components/ui';
import { useAppData } from '../state/AppData';
import { getDB } from '../db/db';
import {
  HistoryImportError,
  formatImportCode,
  isImportCodeShape,
  normalizeImportCode,
} from '../lib/import/historyBundle';
import {
  importHistoryBundle,
  type HistoryImportProgress,
  type HistoryImportResult,
} from '../lib/import/historyImport';
import { nowISO } from '../lib/format';
import { CLEANUP_VERSION } from '../lib/data/cleanup';
import type { DailyLog, ISODate } from '../types';

export default function HistoryImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const app = useAppData();
  const [params] = useSearchParams();
  const urlCode = params.get('code') ?? '';

  const [code, setCode] = useState(formatImportCode(urlCode));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<HistoryImportProgress | null>(null);
  const [result, setResult] = useState<HistoryImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: ISODate; end: ISODate } | null>(null);
  const autoStarted = useRef(false);
  /** 一次性数据清理（v1.3）还没结束时先不要写数据，避免刚导入就被清理掉 */
  const cleanupPending = (app.settings.cleanupVersion ?? 0) < CLEANUP_VERSION;
  /** 导入开始前已经存在的日期（用于结果里说明哪些天是"已有记录、只补空字段"） */
  const preexisting = useRef<Set<ISODate>>(new Set());

  const run = useCallback(
    async (raw: string) => {
      const normalized = normalizeImportCode(raw);
      if (!isImportCodeShape(normalized)) {
        setError('请输入完整的导入码（形如 XXXX-XXXX-XXXX）');
        return;
      }
      setBusy(true);
      setError(null);
      setResult(null);
      preexisting.current = new Set(app.dailyLogs.map((d) => d.date));
      setProgress({ stage: 'download', current: 0, total: 1, label: '正在获取历史数据包…' });
      try {
        const res = await importHistoryBundle(normalized, {
          getDailyLog: async (date) => {
            const row = await getDB().then((db) => db.get('dailyLogs', date));
            return (row as DailyLog | undefined) ?? null;
          },
          createBackupSnapshot: app.createBackupSnapshot,
          saveDailyLog: app.saveDailyLog,
          saveAttachment: app.saveAttachment,
          saveSummary: app.saveSummary,
        }, {
          onProgress: setProgress,
          // 导入码验证通过后，如果这台设备还没跑过 v1.3 的一次性清理，先按同样的流程
          // 清理（先备份），避免刚导入的历史记录被随后的清理删掉。
          // 清理只执行一次（cleanupVersion 标记）；导入码错误时不会动任何数据。
          beforeWrite: async () => {
            if (!cleanupPending) return;
            setProgress({ stage: 'backup', current: 0, total: 1, label: '正在完成首次数据清理…' });
            await app.createBackupSnapshot('首次数据清理前自动备份');
            await app.clearAllRecords();
            await app.saveSettings({ cleanupVersion: CLEANUP_VERSION, cleanupAt: nowISO() });
            preexisting.current = new Set();
          },
          now: nowISO(),
        });
        setResult(res);
        setRange({ start: res.dateStart, end: res.dateEnd });
        toast(
          `导入完成：新增 ${res.created} 天、合并 ${res.merged} 天`,
          res.conflicts.length ? 'info' : 'success',
        );
      } catch (err) {
        const message =
          err instanceof HistoryImportError
            ? err.message
            : '导入失败，请稍后重试（原有数据未受影响）';
        setError(message);
        toast(message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [app, cleanupPending, toast],
  );

  // 支持一次性链接：/#/import/history?code=XXXX-XXXX-XXXX
  useEffect(() => {
    if (autoStarted.current) return;
    if (!isImportCodeShape(urlCode)) return;
    if (!app.ready || cleanupPending) return;
    autoStarted.current = true;
    void run(urlCode);
  }, [urlCode, app.ready, cleanupPending, run]);

  const percent = useMemo(() => {
    if (!progress) return 0;
    if (progress.stage === 'done') return 100;
          if (progress.stage === 'write') {
            return Math.round((progress.current / Math.max(progress.total, 1)) * 100);
          }
          return progress.stage === 'backup' || progress.stage === 'decrypt' ? 25 : 10;
  }, [progress]);

  const conflictsPreview = result?.conflicts.slice(0, 30) ?? [];

  return (
    <Page
      title="导入历史报告"
      sub="本机解密后写入每日记录，不上传任何数据"
      back
    >
      <Card>
        <div className="strong" style={{ fontSize: 17 }}>
          把之前的「今日总结」PDF 报告导入成正式记录
        </div>
        <div className="small muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
          导入包已在你的电脑上解析完成，包含 15 份报告（2026-08-04 ~ 2026-09-10）的
          训练、Apple Watch、睡眠、补剂、饮食与报告原文。为了让公开网站上看不到你的健康数据，
          数据包是加密的，只需要在这里输入一次导入码；解密与写入全部在这台设备本地完成。
        </div>
        <div className="wrap" style={{ gap: 6, marginTop: 10 }}>
          <Chip tone="accent">按报告日期归档</Chip>
          <Chip tone="green">导入前自动备份</Chip>
          <Chip>同日合并不覆盖</Chip>
        </div>
      </Card>

      <Card>
        <Field label="导入码" hint="形如 XXXX-XXXX-XXXX，忽略大小写与连字符">
          <TextInput
            value={code}
            onChange={(v) => setCode(formatImportCode(v))}
            placeholder="XXXX-XXXX-XXXX"
            testId="history-code"
          />
        </Field>
        <Button
          block
          size="lg"
          variant="primary"
          style={{ marginTop: 12 }}
          disabled={busy || !isImportCodeShape(code)}
          data-testid="history-import-start"
          onClick={() => void run(code)}
        >
          {busy ? '正在导入…' : '开始导入'}
        </Button>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          导入过程中请保持页面打开；中途退出只会在下次重新导入时补齐（同一天不会产生重复记录）。
          {cleanupPending
            ? ' 这台设备还没跑过首次数据清理，导入前会先自动备份并完成一次清理。'
            : ''}
        </div>
      </Card>

      {busy && progress && (
        <div data-testid="history-progress">
          <Card>
            <div className="row-between">
              <span className="strong">{progress.label}</span>
              <span className="tiny muted">{percent}%</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Bar value={percent} max={100} />
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              阶段：{stageLabel(progress.stage)}
              {progress.stage === 'write' ? ` · 已写入 ${progress.current}/${progress.total} 天` : ''}
            </div>
          </Card>
        </div>
      )}

      {error && (
        <Card>
          <div className="chip red" style={{ whiteSpace: 'normal' }}>
            {error}
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            原有数据没有受到影响；如果是网络问题，联网后再点一次「开始导入」即可。
          </div>
        </Card>
      )}

      {result && (
        <>
          <SectionTitle>导入结果</SectionTitle>
          <div data-testid="history-result">
          <Card>
            <div className="row wrap" style={{ gap: 6 }}>
              <Chip tone="green">新增 {result.created} 天</Chip>
              {result.merged > 0 && <Chip tone="accent">合并 {result.merged} 天</Chip>}
              {result.unchanged > 0 && <Chip>已是最新 {result.unchanged} 天</Chip>}
              {result.conflicts.length > 0 && (
                <Chip tone="orange">冲突 {result.conflicts.length} 项（保留原记录）</Chip>
              )}
            </div>
            <div className="small muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
              日期范围：{range?.start} ~ {range?.end} · 训练记录 {result.summaryCount} 条 ·
              原始 PDF 附件 {result.attachmentCount} 份
              {result.days.some((d) => preexisting.current.has(d.date))
                ? ` · 其中 ${result.days.filter((d) => preexisting.current.has(d.date)).length} 天导入前已有记录（只补空字段）`
                : ''}
              {result.backupId ? ' · 导入前已自动备份（我的 → 备份与恢复里可导出）' : ''}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <Button
                block
                onClick={() => navigate('/summary?tab=records')}
                data-testid="history-open-records"
              >
                查看我的每日记录
              </Button>
              <Button block onClick={() => navigate('/history')}>
                查看训练历史
              </Button>
            </div>
          </Card>
          </div>

          {result.warnings.length > 0 && (
            <Card>
              <div className="strong" style={{ marginBottom: 6 }}>
                需要留意的地方
              </div>
              {result.warnings.map((w) => (
                <div key={w} className="tiny muted" style={{ lineHeight: 1.7 }}>
                  · {w}
                </div>
              ))}
            </Card>
          )}

          {conflictsPreview.length > 0 && (
            <Card>
              <div className="strong" style={{ marginBottom: 6 }}>
                与已有数据冲突（已保留你原来的记录）
              </div>
              {conflictsPreview.map((c) => (
                <div key={`${c.date}-${c.label}`} className="tiny" style={{ lineHeight: 1.8 }}>
                  {c.date} · {c.label}：已有「{c.existing}」／报告「{c.incoming}」
                </div>
              ))}
              {result.conflicts.length > conflictsPreview.length && (
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  还有 {result.conflicts.length - conflictsPreview.length} 项未列出，可在对应日期里逐项核对。
                </div>
              )}
            </Card>
          )}

          <SectionTitle>本次写入的日期</SectionTitle>
          <Card>
            {result.days.map((d) => (
              <div key={d.date} className="day-row" data-testid={`history-day-${d.date}`}>
                <button
                  className="day-main"
                  onClick={() => navigate(`/summary?tab=today&date=${d.date}`)}
                >
                  <span className="day-date">
                    {d.date}
                    <span className="tiny muted"> {statusLabel(d.status)}</span>
                  </span>
                  <span className="day-summary">{d.imported.join(' · ') || '无字段'}</span>
                  <span className="tiny muted nowrap">{d.hasPdf ? '📄' : ''}</span>
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      <Card flat>
        <div className="tiny muted" style={{ lineHeight: 1.7 }}>
          说明：报告里没有的字段一律留空（不会填 0、也不会按推测补数值）；训练建议和未来计划不会
          被写成"已完成的训练"；同一个日期如果再次导入，只会补充空白项，已有内容保持不变。
        </div>
      </Card>
      <div style={{ height: 24 }} />
    </Page>
  );
}

function stageLabel(stage: HistoryImportProgress['stage']): string {
  switch (stage) {
    case 'download':
      return '下载加密数据包';
    case 'decrypt':
      return '本机解密与校验';
    case 'backup':
      return '自动备份';
    case 'write':
      return '写入每日记录';
    case 'done':
      return '完成';
    default:
      return String(stage);
  }
}

function statusLabel(status: 'created' | 'merged' | 'unchanged'): string {
  if (status === 'created') return '新增';
  if (status === 'merged') return '合并';
  return '已是最新';
}

/** 供其他页面复用的入口（避免各处重复拼路由） */
export const HISTORY_IMPORT_PATH = '/import/history';
