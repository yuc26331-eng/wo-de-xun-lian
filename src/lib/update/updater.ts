/**
 * 应用内更新（检查 → 下载 → 安装 → 重载），用户数据（IndexedDB）完全不受影响。
 *
 * 设计要点：
 * 1) 版本对比：构建产物里的 version.json（网络直取，不走缓存）与当前构建号
 * 2) 完整性校验：version.json 的 build 必须与线上 index.html 的 meta[name=app-build] 一致
 * 3) 安装：让新 Service Worker 接管（SKIP_WAITING）→ controllerchange → 安全重载
 * 4) 失败兜底：保留旧版本继续运行，提供重试与「重新获取最新资源」
 * 5) 回退：更新前把当前可用版本快照存入 app-rollback 缓存，需要时可真正回退
 * 6) 看门狗：新版本启动失败会被下一次启动检测到，并自动执行恢复
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'success'
  | 'error'
  | 'offline';

export interface UpdateInfo {
  version: string;
  build: string;
  buildTime: string;
  notes: string[];
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  currentBuild: string;
  latest: UpdateInfo | null;
  lastCheckedAt: string | null;
  error: string | null;
  /** 0~1，下载/安装阶段的进度估计 */
  progress: number;
  busy: boolean;
  canRollback: boolean;
}

export const PENDING_KEY = 'wdxl:pending-update';
export const LAST_CHECK_KEY = 'wdxl:last-update-check';
export const BOOT_WATCH_KEY = 'wdxl:boot-watch';
export const ROLLBACK_FLAG_KEY = 'wdxl:rollback-active';
export const ROLLBACK_CACHE = 'app-rollback';
export const APP_ID = 'wo-de-xun-lian';

export function currentVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
}

export function currentBuild(): string {
  return typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
}

function baseUrl(): string {
  return import.meta.env.BASE_URL || '/';
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 读取线上最新版本信息，并做完整性校验 */
export async function fetchLatestVersion(): Promise<UpdateInfo> {
  const res = await fetchWithTimeout(`${baseUrl()}version.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
  const data = (await res.json()) as Partial<UpdateInfo> & { app?: string };
  if (data.app !== APP_ID) throw new Error('版本信息格式不正确');
  if (!data.version || typeof data.version !== 'string') throw new Error('版本号缺失');
  if (!data.build || typeof data.build !== 'string') throw new Error('构建号缺失');

  // 完整性校验：线上 index.html 的构建号必须与 version.json 一致
  const htmlRes = await fetchWithTimeout(`${baseUrl()}index.html?t=${Date.now()}`);
  if (!htmlRes.ok) throw new Error('无法读取页面文件');
  const html = await htmlRes.text();
  const match = /<meta\s+name="app-build"\s+content="([^"]+)"/.exec(html);
  if (!match) throw new Error('页面缺少构建标记，无法校验更新包');
  if (match[1] !== data.build) throw new Error('版本信息与页面不一致，请稍后重试');

  return {
    version: data.version,
    build: data.build,
    buildTime: data.buildTime ?? '',
    notes: Array.isArray(data.notes) ? data.notes : [],
  };
}

export function hasUpdate(latest: UpdateInfo): boolean {
  return latest.build !== currentBuild() || latest.version !== currentVersion();
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

function postToWorker(
  worker: ServiceWorker | null | undefined,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (!worker) {
      resolve({ ok: false });
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, timeout: true }), 8000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve((e.data ?? {}) as Record<string, unknown>);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 等到出现 waiting / installed 的新 Service Worker */
async function waitForNewWorker(
  reg: ServiceWorkerRegistration,
  onPhase: (phase: 'downloading' | 'installing', progress: number) => void,
  timeoutMs = 60000,
): Promise<ServiceWorker | null> {
  const start = Date.now();
  let ticker: number | undefined;
  let sawAny = false;
  while (Date.now() - start < timeoutMs) {
    if (reg.waiting) {
      if (ticker) window.clearInterval(ticker);
      return reg.waiting;
    }
    const installing = reg.installing;
    if (installing) {
      sawAny = true;
      if (!ticker) {
        onPhase('downloading', 0.35);
        ticker = window.setInterval(() => {
          const elapsed = Date.now() - start;
          onPhase(
            elapsed < 4000 ? 'downloading' : 'installing',
            Math.min(0.95, 0.2 + elapsed / timeoutMs),
          );
        }, 350);
      }
      if (installing.state === 'installed' || installing.state === 'activated') {
        if (ticker) window.clearInterval(ticker);
        return installing;
      }
    }
    // sw.js 没有任何变化（例如只更新了静态资源）：不要干等，交给安全重载兜底
    if (!sawAny && Date.now() - start > 4000) {
      if (ticker) window.clearInterval(ticker);
      return null;
    }
    await wait(200);
  }
  if (ticker) window.clearInterval(ticker);
  return reg.waiting ?? null;
}

/** 清理程序缓存（不涉及 IndexedDB 用户数据） */
export async function clearProgramCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
}

export interface ApplyHandlers {
  onPhase?: (phase: UpdatePhase, progress: number) => void;
}

function rememberPending(target: UpdateInfo | null): void {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ version: target?.version ?? currentVersion(), at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

/** 下载并安装更新，成功后自动重载；失败时保持当前版本继续可用 */
export async function applyUpdate(
  target: UpdateInfo | null,
  handlers: ApplyHandlers = {},
): Promise<void> {
  const report = (phase: UpdatePhase, progress: number) => handlers.onPhase?.(phase, progress);
  const reg = await getRegistration();
  report('downloading', 0.08);

  if (!reg) {
    await hardRefresh(target, null);
    return;
  }

  // 更新前先给「当前可用版本」拍快照，必要时可以回退
  await postToWorker(reg.active, { type: 'STORE_ROLLBACK', version: currentVersion() });

  try {
    await reg.update();
  } catch (err) {
    console.warn('[update] registration.update 失败', err);
  }

  const worker = await waitForNewWorker(reg, (phase, progress) => report(phase, progress));
  if (!worker) {
    // sw.js 没有变化（可能只是静态资源更新）：走安全重载
    report('installing', 0.8);
    await hardRefresh(target, reg);
    return;
  }

  report('installing', 0.85);
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
    void postToWorker(worker, { type: 'SKIP_WAITING' });
    setTimeout(finish, 8000);
  });

  report('success', 1);
  rememberPending(target);
  await wait(400);
  window.location.reload();
}

/** 清程序缓存并重新加载（保留用户数据），用于无 SW 或更新卡住的情况 */
export async function hardRefresh(
  target: UpdateInfo | null,
  reg: ServiceWorkerRegistration | null | undefined,
): Promise<void> {
  try {
    const registration = reg === undefined ? await getRegistration() : reg;
    await clearProgramCaches();
    if (registration) await registration.update().catch(() => undefined);
  } catch (err) {
    console.warn('[update] 清理缓存失败', err);
  }
  rememberPending(target);
  const url = new URL(window.location.href);
  url.searchParams.set('updated', String(Date.now()));
  window.location.replace(url.toString());
}

/** 应用启动时调用：如果上次刚更新完，返回版本号用于提示「更新完成」 */
export function consumeUpdateSuccess(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: string };
    localStorage.removeItem(PENDING_KEY);
    if (parsed?.version && parsed.version === currentVersion()) return parsed.version;
    return parsed?.version ? currentVersion() : null;
  } catch {
    return null;
  }
}

/** 回退到上一版本（使用 app-rollback 快照） */
export async function rollbackToPrevious(): Promise<void> {
  const reg = await getRegistration();
  if (!reg) throw new Error('当前环境不支持回退（没有 Service Worker）');
  const res = await postToWorker(reg.active, { type: 'ROLLBACK' });
  if (!res.ok) throw new Error('没有可用的上一版本快照');
  try {
    localStorage.setItem(ROLLBACK_FLAG_KEY, '1');
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** 退出回退模式，回到最新版本 */
export async function exitRollback(): Promise<void> {
  const reg = await getRegistration();
  await postToWorker(reg?.active, { type: 'EXIT_ROLLBACK' });
  try {
    localStorage.removeItem(ROLLBACK_FLAG_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function isRollbackActive(): boolean {
  try {
    return localStorage.getItem(ROLLBACK_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 是否存在可回退的快照 */
export async function hasRollbackSnapshot(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(ROLLBACK_CACHE);
    return Boolean(await cache.match('/__rollback/meta'));
  } catch {
    return false;
  }
}

/* ------------------------------ 启动看门狗 ------------------------------ */

export interface BootWatch {
  version: string;
  at: number;
  healthy: boolean;
  attempts: number;
}

function readWatch(): BootWatch | null {
  try {
    const raw = localStorage.getItem(BOOT_WATCH_KEY);
    return raw ? (JSON.parse(raw) as BootWatch) : null;
  } catch {
    return null;
  }
}

function writeWatch(watch: BootWatch): void {
  try {
    localStorage.setItem(BOOT_WATCH_KEY, JSON.stringify(watch));
  } catch {
    /* ignore */
  }
}

/**
 * 启动时调用：如果「上一次启动没有标记健康」，说明可能启动失败，
 * 自动清理程序缓存并重新拉取（最多一次），避免一直白屏。
 */
export function bootWatchdog(): { recovered: boolean } {
  const watch = readWatch();
  const version = currentVersion();
  const now = Date.now();

  const failedBefore =
    watch != null &&
    watch.healthy === false &&
    watch.version === version &&
    now - watch.at > 20000 &&
    (watch.attempts ?? 0) < 1;

  writeWatch({
    version,
    at: now,
    healthy: false,
    attempts: failedBefore ? (watch?.attempts ?? 0) + 1 : (watch?.attempts ?? 0),
  });

  if (failedBefore) {
    void clearProgramCaches().finally(() => {
      try {
        localStorage.setItem('wdxl:recovered-at', String(now));
      } catch {
        /* ignore */
      }
      const url = new URL(window.location.href);
      url.searchParams.set('recovered', String(now));
      window.location.replace(url.toString());
    });
    return { recovered: true };
  }
  return { recovered: false };
}

export function markBootHealthy(): void {
  const watch = readWatch();
  writeWatch({
    version: currentVersion(),
    at: watch?.at ?? Date.now(),
    healthy: true,
    attempts: 0,
  });
}

export function lastCheckedAt(): string | null {
  try {
    return localStorage.getItem(LAST_CHECK_KEY);
  } catch {
    return null;
  }
}

export function rememberChecked(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}
