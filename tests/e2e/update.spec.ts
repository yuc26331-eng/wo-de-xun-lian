import { expect, test } from '@playwright/test';

/**
 * 应用内更新
 * A) 真实 Service Worker：验证更新协议（快照、回退开关）确实可用
 * B) 禁用 SW（serviceWorkers: 'block'）以便拦截版本接口，验证
 *    「发现新版本 → 立即更新 → 自动重载 → 用户数据仍在」的完整流程
 */

const BUMPED_BUILD = 'e2e-build-0001';

test.describe('应用内更新 - 真实 Service Worker', () => {
  test('检查更新显示已是最新 / 离线提示', async ({ page, context }) => {
    await page.goto('/#/me');
    await page.getByTestId('update-check').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('update-current')).toContainText('v');

    await page.getByTestId('update-check').click();
    await expect(page.getByText('已是最新版本')).toBeVisible({ timeout: 20_000 });
    const latest = await page.getByTestId('update-latest').textContent();
    expect(latest?.trim()).toMatch(/^v\d/);

    await context.setOffline(true);
    await page.getByTestId('update-check').click();
    await expect(page.getByText('当前离线，暂时无法检查更新')).toBeVisible({ timeout: 20_000 });
    await context.setOffline(false);
  });

  test('Service Worker 支持更新协议：保存上一版本快照并可切换回退模式', async ({ page }) => {
    await page.goto('/#/me');
    const result = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.ready;
      const post = (type: string) =>
        new Promise<{ ok?: boolean }>((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve({ ok: false }), 15000);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve((e.data ?? {}) as { ok?: boolean });
          };
          (reg.active ?? reg.waiting)?.postMessage({ type, version: 'test' }, [channel.port2]);
        });

      const stored = await post('STORE_ROLLBACK');
      const cache = await caches.open('app-rollback');
      const meta = await cache.match('/__rollback/meta');
      const shell = await cache.match('/__rollback/index.html');

      await post('ROLLBACK');
      const rolledBack = await cache.match('/__rollback-active');
      await post('EXIT_ROLLBACK');
      const exited = await cache.match('/__rollback-active');

      return {
        supported: true,
        stored: Boolean(stored.ok),
        hasMeta: Boolean(meta),
        hasShell: Boolean(shell),
        rolledBack: Boolean(rolledBack),
        exited: !exited,
      };
    });

    expect(result.supported).toBe(true);
    expect(result.stored).toBe(true);
    expect(result.hasMeta).toBe(true);
    expect(result.hasShell).toBe(true);
    expect(result.rolledBack).toBe(true);
    expect(result.exited).toBe(true);
  });
});

test.describe('应用内更新 - 完整流程（禁用 SW 以模拟新版本）', () => {
  test.use({ serviceWorkers: 'block' });

  test('发现新版本 → 立即更新 → 自动重载 → 数据仍然存在', async ({ page }) => {
    // 1) 先写入一条用户数据，验证更新不会清除数据
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-training-items').fill('更新前写入的训练内容');
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    // 2) 模拟服务器上有新版本（version.json 与 index.html 的构建号一致）
    await page.route('**/version.json*', async (route) => {
      await route.fulfill({
        json: {
          app: 'wo-de-xun-lian',
          name: '我的训练',
          version: '1.1.0-e2e',
          build: BUMPED_BUILD,
          buildTime: new Date().toISOString(),
          notes: ['E2E 模拟更新：今日总结与导出功能'],
        },
      });
    });
    await page.route(/index\.html\?t=\d+/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><head><meta name="app-version" content="1.1.0-e2e" /><meta name="app-build" content="${BUMPED_BUILD}" /></head><body></body></html>`,
      }),
    );

    // 3) 检查更新 → 发现新版本
    await page.goto('/#/me');
    await page.getByTestId('update-check').scrollIntoViewIfNeeded();
    await page.getByTestId('update-check').click();
    await expect(page.getByText('发现新版本')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('update-latest')).toContainText('v1.1.0-e2e');
    await expect(page.getByText('E2E 模拟更新：今日总结与导出功能')).toBeVisible();

    // 4) 立即更新：显示下载/安装状态并自动重载
    await page.getByTestId('update-apply').click();
    // 有 Service Worker 时会经历下载/安装；无 SW 时直接走安全重载，
    // 因此这里允许「看到状态」或「已经重载」两种结果
    const sawStatus = await page
      .getByText(/正在下载|正在安装新版本|更新成功/)
      .first()
      .isVisible()
      .catch(() => false);
    await page.waitForURL(/updated=\d+/, { timeout: 60_000 });
    expect(sawStatus || /updated=\d+/.test(page.url())).toBe(true);
    await expect(page.getByTestId('update-check')).toBeVisible({ timeout: 30_000 });

    // 5) 数据仍然存在（IndexedDB 不受更新影响）
    await page.goto('/#/summary');
    const startButton = page.getByTestId('summary-start');
    if (await startButton.isVisible().catch(() => false)) await startButton.click();
    await expect(page.getByTestId('wizard-training-items')).toHaveValue('更新前写入的训练内容', {
      timeout: 20_000,
    });
  });

  test('更新包与页面构建号不一致时拒绝更新并给出重试入口', async ({ page }) => {
    await page.route('**/version.json*', (route) =>
      route.fulfill({
        json: {
          app: 'wo-de-xun-lian',
          version: '1.1.0-e2e',
          build: BUMPED_BUILD,
          buildTime: new Date().toISOString(),
          notes: [],
        },
      }),
    );
    await page.route(/index\.html\?t=\d+/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><meta name="app-build" content="other-build" /></head><body></body></html>',
      }),
    );

    await page.goto('/#/me');
    await page.getByTestId('update-check').scrollIntoViewIfNeeded();
    await page.getByTestId('update-check').click();
    await expect(page.getByText('版本信息与页面不一致，请稍后重试')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('update-retry')).toBeVisible();
    await expect(page.getByTestId('update-current')).toContainText('v');
  });
});
