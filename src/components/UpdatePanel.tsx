/** 「我的 → 版本与更新」：检查更新、立即更新、回退上一版本 */
import { useEffect, useState } from 'react';
import { Button, Card, Chip, useToast } from './ui';
import { phaseLabel, useUpdater } from '../lib/update/useUpdater';
import { consumeUpdateSuccess, isStandalone } from '../lib/update/updater';
import { formatDateCN } from '../lib/format';

function formatTime(iso: string | null): string {
  if (!iso) return '还没有检查过';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${formatDateCN(d.toISOString().slice(0, 10))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function UpdatePanel() {
  const toast = useToast();
  const { state, check, apply, retry, rollback, leaveRollback, rollbackActive } = useUpdater();
  const [installing, setInstalling] = useState(false);

  // 更新完成后的提示（刷新后出现一次）
  useEffect(() => {
    const v = consumeUpdateSuccess();
    if (v) toast(`✓ 更新完成（v${v}）`, 'success');
    const url = new URL(window.location.href);
    if (url.searchParams.has('updated')) {
      url.searchParams.delete('updated');
      window.history.replaceState({}, '', url.toString());
    }
  }, [toast]);

  const label = phaseLabel(state);
  const canApply = state.phase === 'available';
  const working = installing || state.busy;

  return (
    <Card>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="strong" style={{ fontSize: 16 }}>
          版本与更新
        </div>
        <span data-testid="update-status">
          <Chip tone={label.tone === 'default' ? 'default' : label.tone}>{label.text}</Chip>
        </span>
      </div>

      <div className="list" style={{ boxShadow: 'none', margin: 0 }}>
        <div className="list-row">
          <span className="grow small muted">当前版本</span>
          <span className="value" data-testid="update-current">
            v{state.currentVersion}
            <span className="tiny muted"> · {state.currentBuild.slice(0, 7)}</span>
          </span>
        </div>
        <div className="list-row">
          <span className="grow small muted">最新版本</span>
          <span className="value" data-testid="update-latest">
            {state.latest ? `v${state.latest.version}` : '—'}
          </span>
        </div>
        <div className="list-row">
          <span className="grow small muted">上次检查时间</span>
          <span className="value" data-testid="update-checked-at">
            {formatTime(state.lastCheckedAt)}
          </span>
        </div>
        <div className="list-row">
          <span className="grow small muted">运行方式</span>
          <span className="value">{isStandalone() ? '主屏幕 App（独立窗口）' : '浏览器网页'}</span>
        </div>
      </div>

      {state.latest?.notes?.length ? (
        <div style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            更新内容
          </div>
          <ul className="update-notes">
            {state.latest.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.busy ? (
        <div className="bar" style={{ marginTop: 12 }}>
          <i style={{ width: `${Math.max(6, Math.round(state.progress * 100))}%` }} />
        </div>
      ) : null}

      {rollbackActive ? (
        <div className="chip orange" style={{ marginTop: 12 }}>
          当前运行的是回退版本，更新稳定后可退出回退模式
        </div>
      ) : null}

      <div className="col" style={{ gap: 10, marginTop: 14 }}>
        <Button
          block
          size="lg"
          variant="primary"
          disabled={working || !canApply}
          data-testid="update-apply"
          onClick={async () => {
            setInstalling(true);
            try {
              toast('开始下载更新…');
              await apply();
            } finally {
              setInstalling(false);
            }
          }}
        >
          {state.phase === 'downloading' || state.phase === 'installing'
            ? '正在更新…'
            : canApply
              ? '立即更新'
              : '立即更新（检查到新版本后可用）'}
        </Button>

        <div className="row" style={{ gap: 10 }}>
          <Button
            block
            disabled={working}
            data-testid="update-check"
            onClick={() => void check()}
          >
            {state.phase === 'checking' ? '正在检查…' : '检查更新'}
          </Button>
          {state.canRollback ? (
            <Button block disabled={working} onClick={() => void rollback()} data-testid="update-rollback">
              回退到上一版本
            </Button>
          ) : null}
        </div>

        {rollbackActive ? (
          <Button block disabled={working} onClick={() => void leaveRollback()}>
            退出回退模式，使用最新版本
          </Button>
        ) : null}

        {(state.phase === 'error' || state.phase === 'offline') && (
          <Button
            block
            variant="ghost"
            disabled={working}
            data-testid="update-retry"
            onClick={() => void retry()}
          >
            重新获取最新资源（保留本机数据）
          </Button>
        )}
      </div>

      <div className="tiny muted" style={{ marginTop: 12 }}>
        更新只替换程序资源，训练计划、每日记录、Apple Watch 数据、ChatGPT 报告和设置都保存在本机
        IndexedDB 中，不会因为更新被清除。更新失败时会继续使用当前版本。
      </div>
    </Card>
  );
}
