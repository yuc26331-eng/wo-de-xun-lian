/// <reference lib="webworker" />
/**
 * 自定义 Service Worker（vite-plugin-pwa injectManifest）
 *
 * 职责：
 * 1. 预缓存整套应用资源，离线可打开
 * 2. 中文字体按需缓存（导出 PDF 用）
 * 3. 支持「立即更新」：客户端发 SKIP_WAITING，新 SW 立刻接管并刷新
 * 4. 支持「回退到上一版本」：把当前可用版本快照进 app-rollback 缓存，
 *    需要时用快照响应导航请求（真回退，而不是只清缓存）
 *
 * 注意：Service Worker 只管理程序资源，绝不接触 IndexedDB 中的用户数据。
 */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const ROLLBACK_CACHE = 'app-rollback';
const ROLLBACK_MARKER = '/__rollback-active';
const ROLLBACK_INDEX = '/__rollback/index.html';

const manifest = self.__WB_MANIFEST ?? [];
precacheAndRoute(manifest);
cleanupOutdatedCaches();
// 新版本默认进入 waiting 状态，等用户在「检查更新」里点「立即更新」再接管，
// 避免应用正在使用旧资源时被中途替换。
clientsClaim();

const INDEX_URL = new URL('index.html', self.registration.scope).pathname;

/* ------------------------------ 运行时缓存 ------------------------------ */

// 中文字体（导出 PDF 用）：优先命中缓存
registerRoute(
  ({ url, request }) =>
    request.destination === 'font' || /\/fonts\/.*\.(ttf|woff2?)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'cjk-fonts',
    matchOptions: { ignoreSearch: true },
    plugins: [
      new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// version.json 永远走网络，避免“检查更新”读到旧缓存
registerRoute(
  ({ url }) => url.pathname.endsWith('/version.json'),
  ({ request }) => fetch(request, { cache: 'no-store' }),
);

// OCR 运行时与语言模型：首次识别截图时下载，之后离线可用（避免拖慢首屏安装）
registerRoute(
  ({ url }) => /\/ocr\//.test(url.pathname),
  new CacheFirst({
    cacheName: 'ocr-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

/* ------------------------------ 回退支持 ------------------------------ */

async function isRollbackActive(): Promise<boolean> {
  const cache = await self.caches.open(ROLLBACK_CACHE);
  return Boolean(await cache.match(ROLLBACK_MARKER));
}

/** 把当前版本的整套资源快照到 app-rollback（用于回退到上一版本） */
async function storeRollback(version: string): Promise<{ files: number; version: string }> {
  const cache = await self.caches.open(ROLLBACK_CACHE);
  let files = 0;

  for (const entry of manifest) {
    const url = new URL(entry.url, self.registration.scope).toString();
    const cached =
      (await matchPrecache(entry.url)) ??
      (await caches.match(url, { ignoreSearch: true })) ??
      (await fetch(url).catch(() => undefined));
    if (cached) {
      await cache.put(url, cached.clone());
      files += 1;
    }
  }

  // 单独保存一份可用的 shell（导航时直接返回）
  const shell =
    (await matchPrecache('index.html')) ??
    (await matchPrecache(INDEX_URL)) ??
    (await caches.match(new URL('index.html', self.registration.scope).toString()));
  if (shell) {
    await cache.put(ROLLBACK_INDEX, shell.clone());
    files += 1;
  }
  await cache.put(
    '/__rollback/meta',
    new Response(JSON.stringify({ version, at: new Date().toISOString(), files }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  return { files, version };
}

async function setRollback(active: boolean): Promise<void> {
  const cache = await self.caches.open(ROLLBACK_CACHE);
  if (active) {
    await cache.put(ROLLBACK_MARKER, new Response('1'));
  } else {
    await cache.delete(ROLLBACK_MARKER);
  }
}

/* ------------------------------ 导航处理 ------------------------------ */

registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ request }) => {
    // 回退模式：用上一版本的 shell 响应
    if (await isRollbackActive()) {
      const cache = await self.caches.open(ROLLBACK_CACHE);
      const shell = await cache.match(ROLLBACK_INDEX);
      if (shell) {
        // 旧 shell 引用的旧资源也从快照缓存里取
        return shell;
      }
    }

    // 正常模式：预缓存优先，其次是网络
    const precached =
      (await matchPrecache(INDEX_URL)) ?? (await matchPrecache('index.html'));
    if (precached) return precached;
    try {
      return await fetch(request);
    } catch {
      return new Response('离线且没有可用缓存', { status: 503, statusText: 'Offline' });
    }
  },
);

// 回退模式下，旧版本引用的静态资源也从快照里取
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!/\/assets\//.test(url.pathname)) return;
  event.respondWith(
    (async () => {
      if (await isRollbackActive()) {
        const cache = await self.caches.open(ROLLBACK_CACHE);
        const hit = await cache.match(url.toString());
        if (hit) return hit;
      }
      return fetch(request);
    })(),
  );
});

/* ------------------------------ 消息协议 ------------------------------ */

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; version?: string } | undefined;
  if (!data?.type) return;
  const port = event.ports?.[0];

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    port?.postMessage({ ok: true });
    return;
  }
  if (data.type === 'STORE_ROLLBACK') {
    event.waitUntil(
      storeRollback(data.version ?? 'unknown').then((res) => port?.postMessage({ ok: true, ...res })),
    );
    return;
  }
  if (data.type === 'ROLLBACK') {
    event.waitUntil(setRollback(true).then(() => port?.postMessage({ ok: true })));
    return;
  }
  if (data.type === 'EXIT_ROLLBACK') {
    event.waitUntil(setRollback(false).then(() => port?.postMessage({ ok: true })));
  }
});
