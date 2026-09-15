/**
 * 截图附件（Apple Watch / 睡眠）：上传后可预览、下载、删除
 * 二进制存在 IndexedDB 的 attachments store，不随页面刷新丢失，也不会进版本更新缓存。
 */
import { useEffect, useRef, useState } from 'react';
import type { AttachmentKind, ISODate } from '../../types';
import { Button, useToast } from '../ui';
import { IconClose, IconImport } from '../icons';
import { useAppData } from '../../state/AppData';
import { nowISO, uid } from '../../lib/format';

const MAX_SIZE = 12 * 1024 * 1024; // 12MB，防止手机内存压力过大

export function AttachmentsSection({
  date,
  kind,
  attachmentIds,
  onChange,
}: {
  date: ISODate;
  kind: AttachmentKind;
  attachmentIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { attachments, saveAttachment, deleteAttachment, loadAttachment } = useAppData();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const mine = attachments.filter((a) => attachmentIds.includes(a.id) || a.date === date);
  const list = mine.filter((a) => a.kind === kind);

  // 生成预览用的 object URL，并在卸载时释放
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const item of list) {
        const blob = await loadAttachment(item.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[item.id] = url;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((a) => a.id).join('|')]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast('只能上传截图图片', 'error');
          continue;
        }
        if (file.size > MAX_SIZE) {
          toast(`${file.name} 超过 12MB，请压缩后再上传`, 'error');
          continue;
        }
        const id = uid('att');
        await saveAttachment(
          {
            id,
            date,
            kind,
            name: file.name,
            type: file.type,
            size: file.size,
            createdAt: nowISO(),
          },
          file,
        );
        added.push(id);
      }
      if (added.length) {
        onChange([...new Set([...attachmentIds, ...added])]);
        toast(`已添加 ${added.length} 张截图`, 'success');
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="small muted">
          {kind === 'watch' ? 'Apple Watch 截图' : '睡眠截图'}（{list.length}）
        </span>
        <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <IconImport width={15} height={15} style={{ marginRight: 4 }} />
          {busy ? '上传中…' : '上传截图'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        data-testid={`attach-input-${kind}`}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {list.length === 0 ? (
        <div className="tiny muted">可以上传手表或健康 App 的截图，作为原始数据留档。</div>
      ) : (
        <div className="attach-grid">
          {list.map((item) => (
            <div key={item.id} className="attach-item">
              {urls[item.id] ? (
                <img src={urls[item.id]} alt={item.name} />
              ) : (
                <div className="attach-placeholder">加载中…</div>
              )}
              <button
                className="attach-remove"
                aria-label={`删除 ${item.name}`}
                onClick={async () => {
                  await deleteAttachment(item.id);
                  onChange(attachmentIds.filter((id) => id !== item.id));
                  toast('已删除截图', 'success');
                }}
              >
                <IconClose width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
