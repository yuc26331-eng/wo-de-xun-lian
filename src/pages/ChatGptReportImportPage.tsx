/**
 * 分析报告导入确认页
 * 预览：报告标题 / 覆盖日期范围 / 报告正文 / 评价 / 建议 / 风险提醒 / 原始 PDF
 * 用户确认后才写入「ChatGPT 分析报告」历史，绝不覆盖每日原始记录。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionTitle,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { IconTrash } from '../components/icons';
import { useAppData } from '../state/AppData';
import { nowISO, toISODate, uid } from '../lib/format';
import {
  clearReportDraft,
  readReportDraft,
  takePendingPdf,
  type ChatGptReportDraft,
} from '../lib/pdf/parseChatGptReport';
import type { ChatGptReport, ISODate } from '../types';

export default function ChatGptReportImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { saveChatGptReport, chatGptReports } = useAppData();
  const [draft, setDraft] = useState<ChatGptReportDraft | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [evaluation, setEvaluation] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [risks, setRisks] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = readReportDraft();
    if (!d) return;
    setDraft(d);
    setTitle(d.title);
    setStart(d.startDate ?? '');
    setEnd(d.endDate ?? d.startDate ?? '');
    setSummary(d.summaryText);
    setBody(d.bodyText);
    setEvaluation(d.evaluation);
    setSuggestions(d.suggestions);
    setRisks(d.risks);
  }, []);

  const pdf = useMemo(() => (draft ? takePendingPdf(draft.importId) : null), [draft]);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  const rangeWrong = dateOk && start > end;

  const sameRange = useMemo(
    () =>
      chatGptReports.filter(
        (r) => r.startDate === start && r.endDate === end && dateOk,
      ).length,
    [chatGptReports, start, end, dateOk],
  );

  async function save() {
    if (saving || !draft) return;
    if (!dateOk) {
      toast('请填写报告覆盖的开始与结束日期', 'error');
      return;
    }
    if (rangeWrong) {
      toast('开始日期不能晚于结束日期', 'error');
      return;
    }
    setSaving(true);
    try {
      const report: ChatGptReport = {
        id: uid('report'),
        title: title.trim() || `${start} ~ ${end} 分析报告`,
        startDate: start as ISODate,
        endDate: end as ISODate,
        createdAt: nowISO(),
        updatedAt: nowISO(),
        summaryText: summary.trim(),
        bodyText: body.trim(),
        evaluation: evaluation.trim() || undefined,
        suggestions: suggestions.trim() || undefined,
        risks: risks.trim() || undefined,
        rawText: draft.rawText,
        pdfBlob: pdf ?? undefined,
        fileName: draft.fileName,
        pdfSize: draft.fileSize,
        note: note.trim() || undefined,
        tags: tags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        parseWarnings: draft.warnings,
      };
      await saveChatGptReport(report);
      clearReportDraft();
      toast('报告已保存到「ChatGPT 分析报告」', 'success');
      navigate('/summary?tab=chatgpt');
    } catch (err) {
      console.error(err);
      toast('保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <Page title="导入分析报告 PDF" back>
        <Card>
          <EmptyState
            emoji="📄"
            title="没有待确认的分析报告"
            desc="请先在「总结 → 计划 / 报告导入」里选择分析报告 PDF"
            action={
              <Button variant="primary" block size="lg" onClick={() => navigate('/summary?tab=chatgpt')}>
                去导入分析报告
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="导入确认"
      sub={`${draft.fileName} · ${draft.pageCount} 页`}
      back
      hideTab
      right={
        <button className="icon-btn" aria-label="放弃导入" onClick={() => { clearReportDraft(); navigate(-1); }}>
          <IconTrash width={19} height={19} />
        </button>
      }
    >
      <Card>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <Chip tone="purple">ChatGPT 分析报告</Chip>
          <Chip tone={draft.confidence >= 0.7 ? 'green' : 'orange'}>
            识别完整度 {Math.round(draft.confidence * 100)}%
          </Chip>
        </div>
        {draft.warnings.length > 0 && (
          <div className="col" style={{ gap: 6, marginBottom: 10 }}>
            {draft.warnings.map((w) => (
              <div key={w} className="chip orange" style={{ whiteSpace: 'normal' }}>
                {w}
              </div>
            ))}
          </div>
        )}

        <Field label="报告名称（可重命名）">
          <TextInput value={title} onChange={setTitle} testId="report-title" />
        </Field>
        <div className="form-row" style={{ marginTop: 10 }}>
          <div className="grow">
            <Field label="覆盖开始日期">
              <input
                className="input"
                type="date"
                value={start}
                data-testid="report-start"
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="覆盖结束日期">
              <input
                className="input"
                type="date"
                value={end}
                data-testid="report-end"
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
        </div>
        {dateOk && (
          <div className="tiny muted" style={{ marginTop: 6 }}>
            将关联 {start} ~ {end} 的原始记录
            {sameRange > 0 ? `（同一范围已有 ${sameRange} 份报告，可保存为新的版本）` : ''}
          </div>
        )}
        <Field label="报告摘要">
          <TextArea value={summary} onChange={setSummary} rows={4} testId="report-summary" />
        </Field>
      </Card>

      <SectionTitle>完整报告内容</SectionTitle>
      <Card>
        <TextArea value={body} onChange={setBody} rows={10} testId="report-body" />
      </Card>

      <SectionTitle>ChatGPT 的评价 / 建议 / 风险提醒</SectionTitle>
      <Card>
        <Field label="评价">
          <TextArea value={evaluation} onChange={setEvaluation} rows={4} placeholder="如果没有识别到，可以留空或手动补充" />
        </Field>
        <div style={{ marginTop: 12 }}>
          <Field label="建议">
            <TextArea value={suggestions} onChange={setSuggestions} rows={4} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="风险提醒">
            <TextArea value={risks} onChange={setRisks} rows={3} />
          </Field>
        </div>
      </Card>

      <SectionTitle>原始附件与备注</SectionTitle>
      <Card>
        <div className="row-between">
          <span className="small muted">原始 PDF</span>
          <span className="value">
            {pdf ? `${draft.fileName}（${Math.round(draft.fileSize / 1024)} KB，已随报告保存）` : '未获取到（刷新后需要重新选择文件）'}
          </span>
        </div>
        <div className="divider" />
        <Field label="自定义标签（用逗号分隔）">
          <TextInput value={tags} onChange={setTags} placeholder="例如：第一次分析, 恢复后复盘" />
        </Field>
        <div style={{ marginTop: 12 }}>
          <Field label="我的备注">
            <TextArea value={note} onChange={setNote} rows={2} />
          </Field>
        </div>
      </Card>

      <div className="row" style={{ gap: 10, marginTop: 4 }}>
        <Button block size="lg" onClick={() => { clearReportDraft(); navigate('/summary?tab=chatgpt'); }}>
          取消
        </Button>
        <Button
          block
          size="lg"
          variant="primary"
          disabled={saving}
          data-testid="report-save"
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '确认保存'}
        </Button>
      </div>
      <div className="tiny muted center" style={{ marginTop: 10 }}>
        报告只作为独立分析记录保存，不会覆盖你每天填写的原始数据；导入日期 {toISODate()}
      </div>
    </Page>
  );
}
