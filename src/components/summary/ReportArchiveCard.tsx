/**
 * 某一天的历史报告留档卡片（只读）
 * - 训练场次明细：报告里的每场训练时长/距离/热量/心率/RPE
 * - 报告评分、报告原文（可展开）
 * - 原始 PDF 附件：可以在浏览器里打开或下载
 * 数据来自 DailyLog.reportImports，与每天填写的字段分开保存，互不覆盖。
 */
import { useState } from 'react';
import type { DailyLog, ISODate } from '../../types';
import { Button, Card, Chip, useToast } from '../ui';
import { useAppData } from '../../state/AppData';
import { formatDateCN, formatNumber } from '../../lib/format';
import { kindLabel } from '../../lib/import/historyMap';

export function ReportArchiveCard({ log, date }: { log: DailyLog | null; date: ISODate }) {
  const { loadAttachment } = useAppData();
  const toast = useToast();
  const [openText, setOpenText] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reports = log?.reportImports ?? [];
  if (!reports.length) return null;

  const sessions = log?.training?.sessions ?? [];

  async function openPdf(attachmentId: string | undefined, fileName: string, download: boolean) {
    if (!attachmentId) {
      toast('这一天的报告没有保存原始 PDF', 'error');
      return;
    }
    setBusy(attachmentId + (download ? '-dl' : ''));
    try {
      const blob = await loadAttachment(attachmentId);
      if (!blob) {
        toast('原始 PDF 不在本机（可能未导入成功）', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || '报告.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="report-archive">
    <Card>
      <div className="row-between">
        <span className="strong">📄 历史报告留档</span>
        <Chip tone="accent">已归档</Chip>
      </div>
      <div className="tiny muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
        这一天的记录来自你导入的 PDF 报告，原文与附件都保存在本机，可以随时核对；
        每日字段仍可在上面修改，两者互不覆盖。
      </div>

      {reports.map((r) => (
        <div key={r.fileName + r.title} style={{ marginTop: 12 }}>
          <div className="strong" style={{ fontSize: 15 }}>
            {r.title}
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {r.fileName}
            {r.importedAt ? ` · 导入于 ${formatDateCN(r.importedAt.slice(0, 10))}` : ''}
            {r.pdfSize ? ` · ${Math.max(1, Math.round(r.pdfSize / 1024))} KB` : ''}
          </div>
          <div className="wrap" style={{ gap: 6, marginTop: 8 }}>
            {(r.scores ?? []).map((s) => (
              <Chip key={s.label}>
                {s.label} {formatNumber(s.value)}/{s.max}
              </Chip>
            ))}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            <Button size="sm" onClick={() => void openPdf(r.attachmentId, r.fileName, false)}>
              {busy?.startsWith(r.attachmentId ?? 'x') && !busy.endsWith('-dl')
                ? '打开中…'
                : '查看原始 PDF'}
            </Button>
            <Button
              size="sm"
              onClick={() => void openPdf(r.attachmentId, r.fileName, true)}
            >
              下载 PDF
            </Button>
          </div>
        </div>
      ))}

      {sessions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            报告里的训练场次（{sessions.length}）
          </div>
          {sessions.map((s) => {
            const bits = [
              s.durationMin ? `${formatNumber(s.durationMin)} 分钟` : '',
              s.distanceKm ? `${formatNumber(s.distanceKm, 2)} km` : '',
              s.kcal ? `动态 ${formatNumber(s.kcal)} kcal` : '',
              s.avgHr ? `平均心率 ${formatNumber(s.avgHr)}` : '',
              s.maxHr ? `最高心率 ${formatNumber(s.maxHr)}` : '',
              s.paceText ? `配速 ${s.paceText}` : '',
              s.rpe != null ? `RPE ${s.rpe}` : '',
            ].filter(Boolean);
            return (
              <div key={s.name + String(s.durationMin)} className="tiny" style={{ lineHeight: 1.8 }}>
                · {s.name}（{kindLabel(s.kind)}）：{bits.join('，') || '报告未提供数值'}
                {s.note ? <span className="muted">（{s.note}）</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Button size="sm" variant="plain" onClick={() => setOpenText((v) => !v)}>
          {openText ? '收起报告原文' : '查看报告原文（文字层）'}
        </Button>
        {openText && (
          <div
            className="tiny"
            data-testid="report-text"
            style={{
              marginTop: 8,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.8,
              maxHeight: 320,
              overflow: 'auto',
              background: 'var(--card-2)',
              borderRadius: 12,
              padding: 12,
            }}
          >
            {(reports[0].reportText || '').trim() || '（报告没有可提取的文字层）'}
          </div>
        )}
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        报告日期：{date}
      </div>
    </Card>
    </div>
  );
}
