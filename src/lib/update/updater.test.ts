import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_ID,
  BOOT_WATCH_KEY,
  LAST_CHECK_KEY,
  PENDING_KEY,
  ROLLBACK_FLAG_KEY,
  bootWatchdog,
  consumeUpdateSuccess,
  currentBuild,
  currentVersion,
  fetchLatestVersion,
  hasUpdate,
  isRollbackActive,
  lastCheckedAt,
  markBootHealthy,
  rememberChecked,
  type UpdateInfo,
} from './updater';

const versionJson = {
  app: APP_ID,
  name: '我的训练',
  version: '1.1.0',
  build: 'abc123456789',
  buildTime: '2026-09-15T02:00:00.000Z',
  notes: ['今日总结支持六大分区', '新增一键导出给 ChatGPT'],
};

const indexHtml = `<!doctype html><html><head><meta name="app-version" content="1.1.0" />
<meta name="app-build" content="abc123456789" /></head><body></body></html>`;

function mockFetch(handler: (url: string) => { ok?: boolean; body?: string; status?: number }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = handler(url);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => JSON.parse(res.body ?? '{}'),
      text: async () => res.body ?? '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('应用内更新 - 版本检查', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('读取 version.json 并校验 index.html 的构建号（一致性通过）', async () => {
    const fetchMock = mockFetch((url) =>
      url.includes('version.json') ? { body: JSON.stringify(versionJson) } : { body: indexHtml },
    );
    const info = await fetchLatestVersion();
    expect(info.version).toBe('1.1.0');
    expect(info.build).toBe('abc123456789');
    expect(info.notes).toHaveLength(2);
    // 两次请求都要求不走缓存
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('构建号不一致时拒绝应用更新（避免半更新状态）', async () => {
    mockFetch((url) =>
      url.includes('version.json')
        ? { body: JSON.stringify(versionJson) }
        : { body: indexHtml.replace('abc123456789', 'deadbeefcafe') },
    );
    await expect(fetchLatestVersion()).rejects.toThrow('版本信息与页面不一致');
  });

  it('app 标识不对或缺少版本号时报错', async () => {
    mockFetch(() => ({ body: JSON.stringify({ app: 'other-app', version: '1.0.0', build: 'x' }) }));
    await expect(fetchLatestVersion()).rejects.toThrow('版本信息格式不正确');
    vi.unstubAllGlobals();
    mockFetch(() => ({ body: JSON.stringify({ app: APP_ID, build: 'x' }) }));
    await expect(fetchLatestVersion()).rejects.toThrow('版本号缺失');
  });

  it('服务器返回错误状态时给出中文错误', async () => {
    mockFetch(() => ({ ok: false, status: 503, body: '' }));
    await expect(fetchLatestVersion()).rejects.toThrow('服务器返回 503');
  });

  it('版本或构建号一致时判定为已是最新', () => {
    const same: UpdateInfo = {
      version: currentVersion(),
      build: currentBuild(),
      buildTime: '',
      notes: [],
    };
    expect(hasUpdate(same)).toBe(false);
    expect(hasUpdate({ ...same, build: 'different-build' })).toBe(true);
    expect(hasUpdate({ ...same, version: '99.0.0' })).toBe(true);
  });
});

describe('应用内更新 - 状态与数据安全', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('更新成功标记只在版本一致时提示，并立即清除', () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: currentVersion(), at: Date.now() }));
    expect(consumeUpdateSuccess()).toBe(currentVersion());
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(consumeUpdateSuccess()).toBeNull();
  });

  it('上次检查时间会写入 localStorage', () => {
    expect(lastCheckedAt()).toBeNull();
    rememberChecked();
    expect(lastCheckedAt()).not.toBeNull();
    expect(localStorage.getItem(LAST_CHECK_KEY)).toBeTruthy();
  });

  it('回退模式标记可读写', () => {
    expect(isRollbackActive()).toBe(false);
    localStorage.setItem(ROLLBACK_FLAG_KEY, '1');
    expect(isRollbackActive()).toBe(true);
  });

  it('首次启动不触发恢复，并写入看门狗记录', () => {
    const res = bootWatchdog();
    expect(res.recovered).toBe(false);
    const watch = JSON.parse(localStorage.getItem(BOOT_WATCH_KEY) ?? '{}') as {
      version: string;
      healthy: boolean;
    };
    expect(watch.version).toBe(currentVersion());
    expect(watch.healthy).toBe(false);
  });

  it('应用正常启动后标记健康，避免误判为启动失败', () => {
    bootWatchdog();
    markBootHealthy();
    const watch = JSON.parse(localStorage.getItem(BOOT_WATCH_KEY) ?? '{}') as {
      healthy: boolean;
      attempts: number;
    };
    expect(watch.healthy).toBe(true);
    expect(watch.attempts).toBe(0);
  });

  it('新版本启动失败会被下一次启动检测到并自动恢复一次', () => {
    localStorage.setItem(
      BOOT_WATCH_KEY,
      JSON.stringify({
        version: currentVersion(),
        at: Date.now() - 60_000, // 一分钟前启动，且从未标记健康
        healthy: false,
        attempts: 0,
      }),
    );
    const res = bootWatchdog();
    expect(res.recovered).toBe(true);
    const watch = JSON.parse(localStorage.getItem(BOOT_WATCH_KEY) ?? '{}') as {
      attempts: number;
    };
    expect(watch.attempts).toBe(1);

    // 只恢复一次，避免无限刷新
    const second = bootWatchdog();
    expect(second.recovered).toBe(false);
  });
});
