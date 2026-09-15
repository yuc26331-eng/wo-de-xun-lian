/**
 * 数据清理：先自动备份（留档 + 下载），再清空记录；目标保留并更新为指定值。
 * 既用于首次升级后的一次性清理提示，也用于「我的 → 数据管理 → 清空全部记录」。
 */
import { useMemo, useState } from 'react';
import { Button, Sheet, useToast } from './ui';
import { useAppData } from '../state/AppData';
import { CLEANUP_KEEP, CLEANUP_SCOPE } from '../lib/data/cleanup';

export function CleanupSheet({
  open,
  onClose,
  auto = false,
}: {
  open: boolean;
  onClose: () => void;
  auto?: boolean;
}) {
  const toast = useToast();
  const { createBackupSnapshot, clearAllRecords, backups, settings, saveSettings } = useAppData();
  const [busy, setBusy] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);

  const latestBackup = useMemo(
    () => [...backups].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null,
    [backups],
  );

  async function downloadLatest() {
    if (!latestBackup) {
      toast('还没有自动备份', 'error');
      return;
    }
    const blob = new Blob([latestBackup.payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `我的训练-清理前备份-${latestBackup.createdAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已导出清理前的备份', 'success');
  }

  async function backupAndClear() {
    if (busy) return;
    setBusy(true);
    try {
      // 1) 先备份（本机留档 + 下载一份）
      const snapshot = await createBackupSnapshot('数据清理前自动备份');
      const blob = new Blob([snapshot.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `我的训练-清理前备份-${snapshot.createdAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      // 2) 清空记录并更新目标
      const removed = await clearAllRecords();
      await saveSettings({ cleanupVersion: 1 });
      const parts = Object.entries(removed)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${LABELS[k] ?? k} ${n} 条`);
      toast(
        parts.length ? `已备份并清理：${parts.join('、')}` : '已备份并清理（没有需要删除的记录）',
        'success',
      );
      setConfirmAgain(false);
      onClose();
    } catch (err) {
      console.error('[cleanup] 失败', err);
      toast('清理失败：原有数据未被删除，可以重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={auto ? '一次性数据清理' : '清空全部记录'}>
      <div className="small muted">
        {auto
          ? '检测到需要执行的一次性清理：让网站从干净状态开始记录。清理前会自动备份（本机留档 + 下载一份）。'
          : '这会清空本机保存的记录（不可撤销），但会先自动备份一份，目标与设置保留。'}
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>
          将清空
        </div>
        <div className="col" style={{ gap: 4 }}>
          {CLEANUP_SCOPE.map((item) => (
            <div key={item.label} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <span className="tiny muted" style={{ width: 96, flex: '0 0 auto' }}>
                {item.label}
              </span>
              <span className="tiny muted" style={{ flex: 1 }}>
                {item.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="strong" style={{ fontSize: 14, marginBottom: 6 }}>
          将保留
        </div>
        <div className="col" style={{ gap: 4 }}>
          {CLEANUP_KEEP.map((item) => (
            <div key={item} className="tiny muted">
              · {item}
            </div>
          ))}
        </div>
      </div>

      <div className="chip green" style={{ marginTop: 12, whiteSpace: 'normal' }}>
        目标不会被清空，并会更新为：体重 70 kg、体脂率低于 12%
        {settings.bodyFatGoalPct ? '（已设置）' : ''}
      </div>

      {latestBackup && (
        <div className="tiny muted" style={{ marginTop: 10 }}>
          最近一次自动备份：{latestBackup.createdAt.slice(0, 16).replace('T', ' ')}
        </div>
      )}

      {confirmAgain && (
        <div className="chip orange" style={{ marginTop: 12, whiteSpace: 'normal' }}>
          请再次确认：将删除上表列出的全部记录，只有目标和设置保留。备份已生成，可随时恢复。
        </div>
      )}

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        <Button
          block
          size="lg"
          variant="danger"
          disabled={busy}
          data-testid="cleanup-run"
          onClick={() => {
            if (!confirmAgain) {
              setConfirmAgain(true);
              return;
            }
            void backupAndClear();
          }}
        >
          {busy ? '正在备份并清理…' : confirmAgain ? '再次点击确认清理' : '备份并清空全部记录'}
        </Button>
        {latestBackup && (
          <Button block size="lg" onClick={() => void downloadLatest()}>
            下载最近一次自动备份
          </Button>
        )}
        <Button block size="lg" onClick={onClose}>
          {auto ? '稍后再说' : '取消'}
        </Button>
      </div>
    </Sheet>
  );
}

const LABELS: Record<string, string> = {
  sessions: '训练会话',
  summaries: '训练记录',
  dailyLogs: '今日总结',
  bodyMetrics: '身体数据',
  attachments: '截图',
  samplePlans: '示例计划',
};
