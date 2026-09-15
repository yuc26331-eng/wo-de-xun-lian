/**
 * 「一键导出给 ChatGPT」：选择日期范围 → 预览 → 勾选要包含的隐私项 → 导出
 * 支持 PDF / Markdown / JSON / 纯文本四种格式
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Field, Sheet, useToast } from '../ui';
import { useAppData } from '../../state/AppData';
import { addDays, formatNumber, toISODate } from '../../lib/format';
import {
  DEFAULT_INCLUDE,
  buildRangeData,
  buildRangeSummary,
  toMarkdown,
  type ExportContext,
  type ExportInclude,
} from '../../lib/report/chatgptExport';
import { exportChatGptReport, type ReportFormat } from '../../lib/report/exportPdf';

const PRESETS: { label: string; days: number }[] = [
  { label: '单日', days: 1 },
  { label: '最近 3 天', days: 3 },
  { label: '最近 5 天', days: 5 },
  { label: '最近 7 天', days: 7 },
  { label: '最近 10 天', days: 10 },
  { label: '自定义', days: 0 },
];

const INCLUDE_LABELS: { key: keyof ExportInclude; label: string }[] = [
  { key: 'training', label: '训练情况' },
  { key: 'watch', label: 'Apple Watch 数据' },
  { key: 'sleep', label: '睡眠情况' },
  { key: 'body', label: '身体与恢复' },
  { key: 'diet', label: '饮食与补剂' },
  { key: 'notes', label: '用户备注' },
];

export function ExportDialog({
  open,
  onClose,
  initialStart,
  initialEnd,
}: {
  open: boolean;
  onClose: () => void;
  initialStart?: string;
  initialEnd?: string;
}) {
  const toast = useToast();
  const { dailyLogs, summaries, bodyMetrics, attachments } = useAppData();
  const today = toISODate();
  const [start, setStart] = useState(initialStart ?? addDays(today, -6));
  const [end, setEnd] = useState(initialEnd ?? today);
  const [preset, setPreset] = useState<number>(7);
  const [include, setInclude] = useState<ExportInclude>(DEFAULT_INCLUDE);
  const [exporting, setExporting] = useState<ReportFormat | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialStart && initialEnd) {
      setStart(initialStart);
      setEnd(initialEnd);
      setPreset(initialStart === initialEnd ? 1 : 0);
    }
  }, [open, initialStart, initialEnd]);

  const ctx = useMemo<ExportContext>(
    () => ({ dailyLogs, summaries, bodyMetrics, attachments }),
    [dailyLogs, summaries, bodyMetrics, attachments],
  );

  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;

  const preview = useMemo(() => {
    if (!validRange || !open) return null;
    const days = buildRangeData(start, end, ctx);
    const summary = buildRangeSummary(days);
    return { days, summary };
  }, [validRange, open, start, end, ctx]);

  const markdownPreview = useMemo(() => {
    if (!preview) return '';
    const md = toMarkdown(preview.days, preview.summary, include);
    return md.length > 1600 ? `${md.slice(0, 1600)}\n…（预览截断，导出为完整内容）` : md;
  }, [preview, include]);

  function applyPreset(days: number) {
    setPreset(days);
    if (days > 0) {
      setEnd(today);
      setStart(addDays(today, -(days - 1)));
    }
  }

  async function doExport(format: ReportFormat) {
    if (!validRange || exporting) return;
    setExporting(format);
    try {
      const name = await exportChatGptReport({ start, end, include, context: ctx }, format);
      toast(`已导出 ${name}`, 'success');
    } catch (err) {
      console.error('[export] 失败', err);
      toast(err instanceof Error ? err.message : '导出失败，请重试', 'error');
    } finally {
      setExporting(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="一键导出给 ChatGPT">
      <Card>
        <div className="wrap" style={{ gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className={`chip ${preset === p.days ? 'accent' : ''}`}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="grow">
            <Field label="开始日期">
              <input
                className="input"
                type="date"
                value={start}
                data-testid="export-start"
                onChange={(e) => {
                  setStart(e.target.value);
                  setPreset(0);
                }}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="结束日期">
              <input
                className="input"
                type="date"
                value={end}
                data-testid="export-end"
                onChange={(e) => {
                  setEnd(e.target.value);
                  setPreset(0);
                }}
              />
            </Field>
          </div>
        </div>
        {!validRange && (
          <div className="chip red" style={{ marginTop: 8 }}>
            请选择正确的日期范围（开始不晚于结束）
          </div>
        )}
      </Card>

      <Card>
        <div className="small muted" style={{ marginBottom: 8 }}>
          选择要包含的内容（不想发给 ChatGPT 的项目可以取消勾选）
        </div>
        <div className="wrap" style={{ gap: 8 }}>
          {INCLUDE_LABELS.map((item) => {
            const on = include[item.key];
            return (
              <button
                key={item.key}
                className={`chip ${on ? 'accent' : ''}`}
                aria-pressed={on}
                data-testid={`export-include-${item.key}`}
                onClick={() =>
                  setInclude((prev) => {
                    const others = INCLUDE_LABELS.filter((i) => i.key !== item.key).map((i) => i.key);
                    if (on && !others.some((k) => prev[k])) return prev; // 至少保留一项
                    return { ...prev, [item.key]: !on };
                  })
                }
              >
                {on ? '✓ ' : ''}
                {item.label}
              </button>
            );
          })}
        </div>
      </Card>

      {preview && (
        <Card>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <span className="strong">导出预览</span>
            <Chip tone={preview.summary.recordedDays > 0 ? 'green' : 'orange'}>
              {preview.summary.recordedDays}/{preview.summary.dayCount} 天有记录
            </Chip>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {preview.days.map((d) => (
              <div key={d.date} className="row-between tiny">
                <span>{d.date}</span>
                <span className={d.empty ? 'muted' : ''}>
                  {d.empty
                    ? '未记录'
                    : [
                        d.summaries.length ? `训练 ${d.summaries.length}` : '',
                        d.log?.watch?.steps ? `步数 ${d.log.watch.steps}` : '',
                        d.log?.sleep?.totalHours ? `睡眠 ${d.log.sleep.totalHours}h` : '',
                        d.log?.body?.weightKg ? `体重 ${d.log.body.weightKg}kg` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || '已记录'}
                </span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="tiny muted">
            汇总：训练 {preview.summary.trainingCount} 次 · 总时长{' '}
            {Math.round(preview.summary.totalDurationSec / 60)} 分钟 · 跑步{' '}
            {formatNumber(preview.summary.totalRunKm, 2)} km · 平均 RPE{' '}
            {preview.summary.avgRpe ?? '未记录'} · 缺失 {preview.summary.missingDates.length} 天
          </div>
          <details style={{ marginTop: 10 }}>
            <summary className="small">查看 Markdown 预览</summary>
            <pre className="export-preview" data-testid="export-preview">
              {markdownPreview}
            </pre>
          </details>
        </Card>
      )}

      <div className="col" style={{ gap: 10 }}>
        <Button
          block
          size="lg"
          variant="primary"
          disabled={!validRange || exporting !== null}
          data-testid="export-pdf"
          onClick={() => void doExport('pdf')}
        >
          {exporting === 'pdf' ? '正在生成 PDF…' : '导出 PDF（推荐，含文字层）'}
        </Button>
        <div className="row" style={{ gap: 10 }}>
          <Button
            block
            disabled={!validRange || exporting !== null}
            data-testid="export-markdown"
            onClick={() => void doExport('markdown')}
          >
            {exporting === 'markdown' ? '导出中…' : 'Markdown'}
          </Button>
          <Button
            block
            disabled={!validRange || exporting !== null}
            data-testid="export-json"
            onClick={() => void doExport('json')}
          >
            {exporting === 'json' ? '导出中…' : 'JSON'}
          </Button>
          <Button
            block
            disabled={!validRange || exporting !== null}
            data-testid="export-text"
            onClick={() => void doExport('text')}
          >
            {exporting === 'text' ? '导出中…' : '纯文本'}
          </Button>
        </div>
        <div className="tiny muted center">
          文件名格式：训练与恢复记录_开始日期_结束日期.pdf；Markdown 开头会自动附上给 ChatGPT 的说明。
        </div>
      </div>
    </Sheet>
  );
}
