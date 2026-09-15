// 截图网格：缩略图 + 识别状态徽标 + 放大查看 / 重新识别 / 删除
// 识别状态严格按"是否真的提取到字段"显示，绝不出现"已识别但没数据"。
import { useEffect, useState } from 'react';
import type { AttachmentMeta } from '../../types';
import { useAppData } from '../../state/AppData';
import { IconTrash } from '../icons';
import { ImageViewer } from './ImageViewer';

export interface AttachmentGridProps {
  attachments: AttachmentMeta[];
  onRetry?: (shot: AttachmentMeta) => void;
  onDelete?: (shot: AttachmentMeta) => void;
  /** 每张图下方显示的小字（例如"属于：上午训练"） */
  labelOf?: (shot: AttachmentMeta) => string | undefined;
  emptyHint?: string;
}

export function statusInfo(shot: AttachmentMeta): { text: string; cls: string } {
  switch (shot.ocrStatus) {
    case 'done':
      return { text: '已识别', cls: 'done' };
    case 'partial':
      return { text: '部分识别 · 待确认', cls: 'partial' };
    case 'empty':
      return { text: '未识别到有效数据', cls: 'empty' };
    case 'failed':
      return { text: '识别失败', cls: 'failed' };
    default:
      return { text: '识别中', cls: 'pending' };
  }
}

export function AttachmentGrid({
  attachments,
  onRetry,
  onDelete,
  labelOf,
  emptyHint,
}: AttachmentGridProps) {
  const { loadAttachment } = useAppData();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);

  const key = attachments.map((a) => a.id).join('|');

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const shot of attachments) {
        const blob = await loadAttachment(shot.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[shot.id] = url;
      }
      if (!cancelled) setThumbs(next);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!attachments.length) {
    return emptyHint ? (
      <div className="tiny muted" style={{ marginTop: 8 }}>
        {emptyHint}
      </div>
    ) : null;
  }

  return (
    <>
      <div className="attach-grid" style={{ marginTop: 10 }}>
        {attachments.map((shot) => {
          const badge = statusInfo(shot);
          const label = labelOf?.(shot);
          return (
            <div key={shot.id} className="attach-item">
              <button
                className="attach-thumb"
                aria-label={`查看 ${shot.name}`}
                data-testid={`attach-open-${shot.id}`}
                onClick={() =>
                  thumbs[shot.id]
                    ? setViewer({ url: thumbs[shot.id], title: shot.name })
                    : undefined
                }
              >
                {thumbs[shot.id] ? (
                  <img src={thumbs[shot.id]} alt={shot.name} />
                ) : (
                  <div className="attach-placeholder">加载中…</div>
                )}
              </button>
              <div className={`ocr-badge ${badge.cls}`}>{badge.text}</div>
              {label && <div className="attach-label tiny muted">{label}</div>}
              <div className="attach-actions">
                {onRetry && (
                  <button
                    aria-label="重新识别"
                    data-testid={`ocr-retry-${shot.id}`}
                    onClick={() => onRetry(shot)}
                  >
                    ↻
                  </button>
                )}
                {onDelete && (
                  <button
                    aria-label="删除截图"
                    className="danger"
                    data-testid={`attach-delete-${shot.id}`}
                    onClick={() => onDelete(shot)}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <ImageViewer
        open={viewer != null}
        url={viewer?.url ?? null}
        title={viewer?.title}
        onClose={() => setViewer(null)}
      />
    </>
  );
}
