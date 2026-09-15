/** 应用内更新的 React 封装：状态机 + 防重复点击 + 自动检查 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyUpdate,
  currentBuild,
  currentVersion,
  exitRollback,
  fetchLatestVersion,
  hardRefresh,
  hasRollbackSnapshot,
  hasUpdate,
  isOnline,
  isRollbackActive,
  lastCheckedAt,
  rememberChecked,
  rollbackToPrevious,
  type UpdateInfo,
  type UpdatePhase,
  type UpdateState,
} from './updater';

const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export interface UpdaterApi {
  state: UpdateState;
  check: (opts?: { silent?: boolean }) => Promise<void>;
  apply: () => Promise<void>;
  retry: () => Promise<void>;
  rollback: () => Promise<void>;
  leaveRollback: () => Promise<void>;
  rollbackActive: boolean;
}

export function useUpdater(): UpdaterApi {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [latest, setLatest] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [checked, setChecked] = useState<string | null>(() => lastCheckedAt());
  const [canRollback, setCanRollback] = useState(false);
  const [rollbackActive, setRollbackActive] = useState(() => isRollbackActive());
  const busy = useRef(false);

  const refreshRollback = useCallback(async () => {
    setCanRollback(await hasRollbackSnapshot());
    setRollbackActive(isRollbackActive());
  }, []);

  useEffect(() => {
    void refreshRollback();
  }, [refreshRollback]);

  const check = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (busy.current) return;
    busy.current = true;
    if (!opts.silent) setError(null);
    setPhase('checking');
    setProgress(0);
    try {
      if (!isOnline()) {
        setPhase('offline');
        setError('当前离线，暂时无法检查更新');
        return;
      }
      const info = await fetchLatestVersion();
      setLatest(info);
      const at = new Date().toISOString();
      rememberChecked();
      setChecked(at);
      setPhase(hasUpdate(info) ? 'available' : 'latest');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '检查更新失败');
      setPhase(isOnline() ? 'error' : 'offline');
    } finally {
      busy.current = false;
    }
  }, []);

  const apply = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (!isOnline()) {
        setPhase('offline');
        setError('当前离线，暂时无法下载更新');
        return;
      }
      await applyUpdate(latest, {
        onPhase: (p, ratio) => {
          setPhase(p);
          setProgress(ratio);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败，请重试');
      setPhase('error');
    } finally {
      busy.current = false;
    }
  }, [latest]);

  const retry = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase('downloading');
    setProgress(0.05);
    try {
      await hardRefresh(latest, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败，请重试');
      setPhase('error');
      busy.current = false;
    }
  }, [latest]);

  const rollback = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await rollbackToPrevious();
    } catch (err) {
      setError(err instanceof Error ? err.message : '回退失败');
      setPhase('error');
      busy.current = false;
    }
  }, []);

  const leaveRollback = useCallback(async () => {
    busy.current = true;
    await exitRollback();
  }, []);

  // 打开应用后自动静默检查一次（10 分钟内不重复），并在网络恢复时提示
  useEffect(() => {
    const last = lastCheckedAt();
    const stale = !last || Date.now() - new Date(last).getTime() > AUTO_CHECK_INTERVAL_MS;
    if (stale && isOnline()) void check({ silent: true });

    const onOnline = () => {
      setPhase((p) => (p === 'offline' ? 'idle' : p));
      void check({ silent: true });
    };
    const onOffline = () => setPhase('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [check]);

  const state = useMemo<UpdateState>(
    () => ({
      phase,
      currentVersion: currentVersion(),
      currentBuild: currentBuild(),
      latest,
      lastCheckedAt: checked,
      error,
      progress,
      busy: phase === 'checking' || phase === 'downloading' || phase === 'installing',
      canRollback,
    }),
    [phase, latest, checked, error, progress, canRollback],
  );

  return { state, check, apply, retry, rollback, leaveRollback, rollbackActive };
}

/** 状态对应的中文文案（与旅行站保持一致的六种状态） */
export function phaseLabel(state: UpdateState): { text: string; tone: 'default' | 'accent' | 'green' | 'orange' | 'red' } {
  switch (state.phase) {
    case 'checking':
      return { text: '正在检查更新…', tone: 'accent' };
    case 'latest':
      return { text: '已是最新版本', tone: 'green' };
    case 'available':
      return { text: '发现新版本', tone: 'orange' };
    case 'downloading':
      return { text: `正在下载${state.progress ? ` ${Math.round(state.progress * 100)}%` : '…'}`, tone: 'accent' };
    case 'installing':
      return { text: '正在安装新版本…', tone: 'accent' };
    case 'success':
      return { text: '更新成功，正在重新加载…', tone: 'green' };
    case 'offline':
      return { text: '当前离线，暂时无法检查更新', tone: 'default' };
    case 'error':
      return { text: state.error ?? '更新失败，请重试', tone: 'red' };
    default:
      return { text: '尚未检查更新', tone: 'default' };
  }
}
