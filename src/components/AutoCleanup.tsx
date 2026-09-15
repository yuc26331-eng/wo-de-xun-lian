/**
 * 一次性数据清理（自动执行）
 * 首次升级到 v1.3 后打开应用时：自动备份 → 清空旧记录 → 更新目标为体重 70kg / 体脂低于 12%
 * 清理完成后弹出结果：可下载备份，也可一键恢复本次清理前的数据。
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Card, useToast } from './ui';
import { useAppData } from '../state/AppData';
import { CLEANUP_VERSION } from '../lib/data/cleanup';
import type { BackupSnapshot } from '../types';
import { nowISO } from '../lib/format';

const LABELS: Record<string, string> = {
  sessions: '训练会话',
  summaries: '训练记录',
  dailyLogs: '今日总结',
  bodyMetrics: '身体数据',
  attachments: '截图',
  samplePlans: '示例计划',
};

export function AutoCleanup() {
  const toast = useToast();
  const { ready, settings, createBackupSnapshot, clearAllRecords, restoreBackup, saveSettings } =
    useAppData();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [snapshot, setSnapshot] = useState<BackupSnapshot | null>(null);
  const [removed, setRemoved] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!ready || ran.current) return;
    if ((settings.cleanupVersion ?? 0) >= CLEANUP_VERSION) return;
    ran.current = true;
    void (async () => {
      setPhase('running');
      try {
        const backup = await createBackupSnapshot('v1.3 一次性清理前自动备份');
        const result = await clearAllRecords();
        await saveSettings({ cleanupVersion: CLEANUP_VERSION, cleanupAt: nowISO() });
        setSnapshot(backup);
        setRemoved(result);
        setPhase('done');
      } catch (err) {
        console.error('[cleanup] 自动清理失败', err);
        setPhase('error');
      }
    })();
  }, [ready, settings.cleanupVersion, createBackupSnapshot, clearAllRecords, saveSettings]);

  async function downloadBackup() {
    if (!snapshot) return;
    const blob = new Blob([snapshot.payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `我的训练-清理前备份-${snapshot.createdAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('备份已导出', 'success');
  }

  if (phase === 'idle') return null;

  if (phase === 'running') {
    return (
      <Card flat>
        <div className="small">正在备份并执行一次性数据清理…</div>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          先备份到本机，再清空旧记录；目标与设置会保留。
        </div>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Card>
        <div className="strong" style={{ fontSize: 15 }}>
          一次性清理未完成
        </div>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          原有数据未被删除。可以稍后在「我的 → 数据管理 → 清空全部记录」里手动执行。
        </div>
      </Card>
    );
  }

  if (dismissed) return null;

  const parts = Object.entries(removed)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${LABELS[k] ?? k} ${n} 条`);

  return (
    <div data-testid="cleanup-result">
    <Card className="cleanup-banner">
      <div className="row-between">
        <span className="strong" style={{ fontSize: 15 }}>
          ✅ 数据清理已完成
        </span>
        <span className="chip green nowrap">已自动备份</span>
      </div>
      <div className="small" style={{ lineHeight: 1.6, marginTop: 6 }}>
        {parts.length ? `已删除：${parts.join('、')}。` : '没有需要删除的记录。'}
      </div>
      <div className="col" style={{ gap: 4, marginTop: 10 }}>
        <div className="tiny muted">· 目标保留并更新为：体重 70 kg、体脂率低于 12%</div>
        <div className="tiny muted">· 动作库、模板、PR、ChatGPT 报告与更新设置未受影响</div>
        <div className="tiny muted">
          · 备份时间：{snapshot ? snapshot.createdAt.slice(0, 16).replace('T', ' ') : '—'}
          （本机留档，可下载）
        </div>
      </div>
      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        <Button block size="lg" variant="primary" data-testid="cleanup-download" onClick={() => void downloadBackup()}>
          下载清理前备份
        </Button>
        <Button
          block
          size="lg"
          disabled={restoring}
          data-testid="cleanup-restore"
          onClick={async () => {
            if (!snapshot || restoring) return;
            setRestoring(true);
            try {
              await restoreBackup(JSON.parse(snapshot.payload));
              toast('已恢复清理前的数据', 'success');
              setDismissed(true);
            } catch (err) {
              console.error('[cleanup] 恢复失败', err);
              toast('恢复失败，备份仍保留在本机', 'error');
            } finally {
              setRestoring(false);
            }
          }}
        >
          {restoring ? '正在恢复…' : '恢复清理前的数据'}
        </Button>
        <Button block size="lg" data-testid="cleanup-dismiss" onClick={() => setDismissed(true)}>
          知道了
        </Button>
      </div>
    </Card>
    </div>
  );
}
