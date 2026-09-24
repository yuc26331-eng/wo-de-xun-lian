/** 「导入分析报告」按钮：本地解析 PDF 文字 → 进入分析报告预览确认页 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { classifyPdf, looksLikePlanDocumentTitle } from '../lib/pdf/classify';
import { Button, useToast } from './ui';
import { IconImport } from './icons';
import {
  parseChatGptReportText,
  saveReportDraft,
  stashPendingPdf,
} from '../lib/pdf/parseChatGptReport';

export function ImportChatGptReportButton({
  variant = 'primary',
  size = 'lg',
  block,
  label = '导入分析报告 PDF',
  testId = 'import-chatgpt-report',
}: {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  label?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
    if (busy) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('请选择 PDF 文件', 'error');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast('文件超过 30MB，请压缩后再试', 'error');
      return;
    }
    setBusy(true);
    try {
      const { readPdfFile } = await import('../lib/pdf/readPdf');
      const extracted = await readPdfFile(file);
      if (extracted.ocrRequired || extracted.text.trim().length < 20) {
        toast('这份 PDF 没有可提取文字（可能是扫描版/图片），需要 OCR 才能导入', 'error');
        return;
      }
      const kind = classifyPdf(extracted.text, extracted.fileName).kind;
      if (
        (kind === 'plan' || kind === 'weekly-plan') &&
        looksLikePlanDocumentTitle(extracted.text, extracted.fileName)
      ) {
        toast('这份 PDF 更像训练计划，请改用「导入训练计划」入口', 'error');
        return;
      }
      const draft = parseChatGptReportText(extracted.text, {
        fileName: extracted.fileName,
        fileSize: extracted.fileSize,
        pageCount: extracted.pageCount,
      });
      saveReportDraft(draft);
      stashPendingPdf(draft.importId, file);
      navigate('/import/chatgpt');
    } catch (err) {
      console.error('[chatgpt-report] 解析失败', err);
      toast(err instanceof Error ? err.message : 'PDF 解析失败，请重试', 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div data-testid={testId}>
      <Button
        block={block}
        data-testid={`${testId}-button`}
        variant={variant}
        size={size}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <IconImport width={17} height={17} style={{ marginRight: 6 }} />
        {busy ? '正在解析 PDF…' : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handle(file);
        }}
      />
    </div>
  );
}
