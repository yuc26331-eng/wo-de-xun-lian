// 截图放大查看（原图保存在本机，点击卡片即可放大；支持双击放大/缩小）
import { useEffect, useState } from 'react';

export interface ImageViewerProps {
  open: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}

export function ImageViewer({ open, url, title, onClose }: ImageViewerProps) {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !url) return null;

  return (
    <div className="viewer-mask" role="dialog" aria-label="查看截图" data-testid="image-viewer">
      <button className="viewer-close" aria-label="关闭" onClick={onClose}>
        ✕
      </button>
      <div className="viewer-body" onClick={() => setZoomed((v) => !v)}>
        <img
          src={url}
          alt={title ?? '截图'}
          className={zoomed ? 'zoomed' : ''}
          style={{ touchAction: 'pinch-zoom' }}
        />
      </div>
      <div className="viewer-foot">
        <span className="tiny">{title ?? ''}</span>
        <span className="tiny muted">{zoomed ? '双击缩小' : '双击可放大'}</span>
      </div>
    </div>
  );
}
