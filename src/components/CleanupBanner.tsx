/**
 * 一次性数据清理横幅（首页顶部）
 * 不遮挡其它操作：点「备份并清理」打开确认弹层，弹层里会先自动备份再清空记录。
 */
import { useState } from 'react';
import { Button, Card } from './ui';
import { useAppData } from '../state/AppData';
import { CLEANUP_VERSION } from '../lib/data/cleanup';
import { CleanupSheet } from './CleanupSheet';

export function CleanupBanner() {
  const { ready, settings } = useAppData();
  const [open, setOpen] = useState(false);
  const [snoozed, setSnoozed] = useState(false);

  const pending = ready && (settings.cleanupVersion ?? 0) < CLEANUP_VERSION;
  if (!pending || snoozed) return <CleanupSheet open={open} onClose={() => setOpen(false)} auto />;

  return (
    <>
      <div data-testid="cleanup-banner">
      <Card className="cleanup-banner">
        <div className="row-between">
          <span className="strong" style={{ fontSize: 15 }}>
            📦 一次性数据清理待执行
          </span>
          <span className="chip orange nowrap">建议现在完成</span>
        </div>
        <div className="tiny muted" style={{ marginTop: 6, lineHeight: 1.5 }}>
          清空历史训练记录、今日总结、运动与睡眠、身体数据、截图与草稿（会先自动备份一份）。
          目标保留并更新为：体重 70 kg、体脂率低于 12%。
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <Button
            block
            variant="primary"
            data-testid="cleanup-banner-run"
            onClick={() => setOpen(true)}
          >
            备份并清理
          </Button>
          <Button block data-testid="cleanup-banner-later" onClick={() => setSnoozed(true)}>
            稍后
          </Button>
        </div>
      </Card>
      </div>
      <CleanupSheet open={open} onClose={() => setOpen(false)} auto />
    </>
  );
}
