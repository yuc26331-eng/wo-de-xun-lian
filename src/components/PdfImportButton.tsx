/**
 * PDF 导入入口（首页 / 训练页 / 总结页共用）
 * - iPhone：点击调用「文件」选择器
 * - 电脑：支持拖拽上传
 * - 解析全部在浏览器本地完成，不上传任何文件
 */
import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PdfReadError } from '../lib/pdf/importFile';
import { useAppData } from '../state/AppData';
import { Button, Sheet, useToast } from './ui';
import { IconImport } from './icons';

type Variant = 'primary' | 'default' | 'ghost';
type Size = 'sm' | 'md' | 'lg' | 'xl';

/** PDF 解析库（pdf.js）体积较大，只在用户真的要导入时按需加载 */
async function loadPdfLib() {
  return import('../lib/pdf/importFile');
}

function messageFor(err: unknown): string {
  if (err instanceof Error && 'code' in err) {
    switch ((err as PdfReadError).code) {
      case 'not-pdf':
        return '请选择 PDF 文件。';
      case 'too-large':
        return '文件太大（超过 60MB），请先压缩或拆分后再导入。';
      case 'password':
        return '这个 PDF 有密码保护，请先另存为无密码版本。';
      case 'invalid':
        return 'PDF 无法打开：文件可能已损坏。';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : '导入失败，请重试。';
}

/**
 * 统一的导入流程：读文件 → 解析 → 保存原始记录 → 跳转导入确认页
 * 返回 true 表示流程已经接管（成功或失败都会给出提示）
 */
function usePdfImporter() {
  const navigate = useNavigate();
  const toast = useToast();
  const { savePdfImport, pdfImports } = useAppData();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  async function run(file: File) {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const { importPdfFile, isAlreadySaved } = await loadPdfLib();
      if (isAlreadySaved(pdfImports, file.name, file.size)) {
        const previous = pdfImports.find((r) => r.saved && r.fileName === file.name);
        setDuplicate({ id: previous?.id ?? '', name: file.name });
        return;
      }
      const outcome = await importPdfFile(file, {
        onProgress: (ratio) => setProgress(ratio),
        save: savePdfImport,
      });
      if (outcome.record.ocrRequired) {
        toast('这是扫描版 PDF，需要 OCR 才能识别文字', 'error');
      } else {
        toast('解析完成，请确认识别结果', 'success');
      }
      navigate(`/import/confirm?import=${outcome.record.id}`);
    } catch (err) {
      const message = messageFor(err);
      setError(message);
      toast(message, 'error');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return { run, busy, progress, error, clearError: () => setError(null), duplicate, clearDuplicate: () => setDuplicate(null), navigate };
}

export function PdfImportButton({
  variant = 'primary',
  size = 'md',
  block,
  label = '导入 ChatGPT PDF',
  className,
  testId,
}: {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const importer = usePdfImporter();

  return (
    /* 容器上带 testId，e2e 用 `[data-testid="import-pdf"] input[type=file]` 直接塞文件 */
    <div data-testid={testId} className="import-button-wrap">
      <Button
        variant={variant}
        size={size}
        block={block}
        className={className}
        data-testid={testId ? `${testId}-button` : undefined}
        disabled={importer.busy}
        onClick={() => inputRef.current?.click()}
      >
        <IconImport width={18} height={18} style={{ marginRight: 6 }} />
        {importer.busy
          ? `解析中 ${Math.round(importer.progress * 100)}%`
          : label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importer.run(file);
        }}
      />
      <ImportFeedback importer={importer} />
    </div>
  );
}

export function PdfDropZone({
  label = '把 PDF 拖到这里，或点击选择文件',
  className,
  compact,
  onDone,
  testId,
}: {
  label?: string;
  className?: string;
  compact?: boolean;
  onDone?: (importId: string) => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const importer = usePdfImporter();

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void importer.run(file);
  }

  return (
    /* 容器上带 testId，便于 e2e 直接向 input 塞文件 */
    <div data-testid={testId} className="import-button-wrap">
      <div
        className={`drop-zone ${over ? 'over' : ''} ${compact ? 'compact' : ''} ${className ?? ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <IconImport width={compact ? 20 : 26} height={compact ? 20 : 26} />
        <span className="small" style={{ marginTop: compact ? 2 : 6 }}>
          {importer.busy ? `正在解析 ${Math.round(importer.progress * 100)}%` : label}
        </span>
        {!compact && (
          <span className="tiny muted" style={{ marginTop: 4 }}>
            支持 健身计划 / 今日总结 / 周计划 / 身体数据报告，全部在本机解析
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importer.run(file);
        }}
      />
      <ImportFeedback importer={importer} onDone={onDone} />
    </div>
  );
}

function ImportFeedback({
  importer,
  onDone,
}: {
  importer: ReturnType<typeof usePdfImporter>;
  onDone?: (importId: string) => void;
}) {
  return (
    <>
      <Sheet
        open={importer.duplicate != null}
        onClose={importer.clearDuplicate}
        title="这个文件之前导入过"
        footer={
          <div className="col" style={{ gap: 10 }}>
            {importer.duplicate?.id && (
              <Button
                block
                size="lg"
                variant="primary"
                onClick={() => {
                  const id = importer.duplicate?.id;
                  importer.clearDuplicate();
                  if (id) {
                    if (onDone) onDone(id);
                    importer.navigate(`/import/confirm?import=${id}`);
                  }
                }}
              >
                查看上次的导入结果
              </Button>
            )}
            <Button block size="lg" onClick={() => importer.clearDuplicate()}>
              知道了
            </Button>
          </div>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          为了避免重复记录，同一份 PDF 不会再次覆盖已有数据。你可以查看上次的导入结果，或在「我的 →
          PDF 导入记录」里删除旧记录后重新导入。
        </p>
      </Sheet>

      <Sheet
        open={importer.error != null}
        onClose={importer.clearError}
        title="导入失败"
        footer={
          <Button block size="lg" onClick={importer.clearError}>
            知道了
          </Button>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          {importer.error}
        </p>
        <div className="tiny muted">
          你也可以在「训练 → 新建计划」里手动录入今天的训练内容。
        </div>
      </Sheet>
    </>
  );
}
