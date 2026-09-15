import { expect, test } from '@playwright/test';
import { ensureTrainingPlan } from './helpers';

test.describe('PWA / 离线能力', () => {
  test('Manifest、图标与独立窗口配置正确', async ({ page, request }) => {
    await page.goto('/');

    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    expect(manifestHref, 'index.html 里应有 manifest 链接').toBeTruthy();
    const res = await request.get(manifestHref!);
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; purpose?: string }[];
      background_color: string;
      theme_color: string;
    };
    expect(manifest.name).toContain('我的训练');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBeTruthy();
    expect(manifest.icons.some((i) => i.sizes === '512x512')).toBeTruthy();
    expect(manifest.icons.some((i) => (i.purpose ?? '').includes('maskable'))).toBeTruthy();

    for (const icon of manifest.icons) {
      const url = new URL(icon.src, page.url()).toString();
      const iconRes = await request.get(url);
      expect(iconRes.ok(), `图标应可访问：${icon.src}`).toBeTruthy();
    }

    const appleIcon = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
    expect(appleIcon).toBeTruthy();
    expect((await request.get(new URL(appleIcon!, page.url()).toString())).ok()).toBeTruthy();
  });

  test('Service Worker 注册成功，离线后仍可打开', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByText('今日状态')).toBeVisible();

    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    });
    expect(swReady, 'Service Worker 应在生产构建中注册成功').toBe(true);

    // 触发一次导航请求，确保缓存写入
    await page.goto('/#/train');
    await expect(page.getByRole('heading', { name: '训练' })).toBeVisible();

    await context.setOffline(true);
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '我的训练' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('今日状态')).toBeVisible();
    await context.setOffline(false);
  });

  test('刷新与重新打开后本地数据仍在（IndexedDB）', async ({ page }) => {
    await ensureTrainingPlan(page);
    await page.goto('/');
    await expect(page.getByText('本周训练', { exact: true })).toBeVisible();
    // 记录首页展示的今日计划标题
    const planTitle = await page
      .locator('[data-testid="today-plan-title"]')
      .first()
      .textContent();
    expect(planTitle?.trim().length).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByText('最近训练', { exact: true })).toBeVisible();
    await expect(page.getByText('今天练什么', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="today-plan-title"]').first()).toHaveText(
      planTitle!.trim(),
    );

    // 数据确实持久化在 IndexedDB 中（不是内存态）
    const counts = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('wo-de-xun-lian');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const count = (store: string) =>
        new Promise<number>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      return {
        plans: await count('plans'),
        exercises: await count('exercises'),
        metrics: await count('bodyMetrics'),
      };
    });
    expect(counts.plans).toBeGreaterThan(0);
    expect(counts.exercises).toBeGreaterThan(0);
  });
});
