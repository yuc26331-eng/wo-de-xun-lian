/**
 * 线上地址验收脚本（iPhone 尺寸）
 * 用法：node tools/verify-live.mjs [url] [outDir]
 * 校验：页面可打开、五个页面无横向滚动、Manifest/Service Worker 生效、核心流程可用、离线可打开
 */
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const url = (process.argv[2] ?? 'https://yuc26331-eng.github.io/wo-de-xun-lian/').replace(/\/$/, '');
const out = process.argv[3] ?? '../work/live';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'zh-CN' });
const page = await context.newPage();

async function noHorizontalScroll(label) {
  const overflow = await page.evaluate(() => ({
    widest: Math.max(
      document.documentElement.scrollWidth,
      ...Array.from(document.querySelectorAll('body *')).map((el) =>
        Math.ceil(el.getBoundingClientRect().right + window.scrollX),
      ),
    ),
    viewport: window.innerWidth,
  }));
  check(`${label} 无横向滚动`, overflow.widest <= overflow.viewport + 1, `最宽 ${overflow.widest} / 视口 ${overflow.viewport}`);
}

await page.goto(`${url}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=今日计划', { timeout: 30000 });
check('线上首页可打开且渲染中文界面', true, url);

await page.screenshot({ path: `${out}/live-home.png`, fullPage: true });

for (const [label, hash] of [
  ['训练', '/train'],
  ['数据', '/data'],
  ['总结', '/summary'],
  ['我的', '/me'],
]) {
  await page.goto(`${url}/#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await noHorizontalScroll(label);
}

// Manifest 与 Service Worker
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('Manifest 已链接', Boolean(manifestHref), manifestHref ?? '');
const manifest = await page.evaluate(async (href) => {
  const res = await fetch(href, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}, manifestHref);
check(
  'Manifest 为 standalone 且含图标',
  manifest?.display === 'standalone' && (manifest?.icons?.length ?? 0) >= 2,
  `display=${manifest?.display} icons=${manifest?.icons?.length}`,
);
check('Manifest 名称正确', String(manifest?.name ?? '').includes('我的训练'), manifest?.name ?? '');

const swOk = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  return Boolean(reg.active);
});
check('Service Worker 注册成功', swOk);

// 核心流程：开始训练 → 完成一组 → 结束 → 生成总结
await page.goto(`${url}/#/`, { waitUntil: 'networkidle' });
await page.getByTestId('start-training').click();
await page.waitForSelector('[data-testid="live-progress"]', { timeout: 20000 });
const progressText = await page.getByTestId('live-progress').textContent();
check('进入实时跟练并显示动作进度', /动作\s*1\//.test(progressText ?? ''), progressText?.trim());
await page.getByTestId('live-complete-set').click();
await page.waitForTimeout(500);
const restVisible = await page.getByTestId('live-rest-timer').isVisible().catch(() => false);
check('自动进入组间休息倒计时', restVisible);
const footerText = await page.locator('[data-testid="live-progress-done"]').textContent().catch(() => '');
check('完成本组已记录（休息界面显示进度）', /已完成\s*1\//.test(footerText ?? ''), footerText?.trim() ?? '');

// 跳过休息后回到动作卡片，组圆点应显示 1 组已完成
if (restVisible) {
  await page.getByTestId('live-rest-skip').click();
  await page.waitForTimeout(400);
}
const doneDots = await page.locator('.set-dot.done').count();
check('动作卡片显示已完成组数', doneDots === 1, `已完成 ${doneDots} 组`);
const cardProgress = await page
  .locator('[data-testid="live-progress-done"]')
  .textContent()
  .catch(() => '');
check('完成本组后计数为 1（防重复记录）', /已完成\s*1\//.test(cardProgress ?? ''), cardProgress?.trim() ?? '');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="live-progress"]', { timeout: 20000 });
const reloadedFooter = await page
  .locator('[data-testid="live-progress-done"]')
  .textContent()
  .catch(() => '');
check(
  '刷新后可恢复未完成训练（IndexedDB）',
  /已完成\s*1\//.test(reloadedFooter ?? ''),
  reloadedFooter?.trim() ?? '',
);

await page.getByTestId('live-pause').click();
await page.getByTestId('live-end-early').click();
await page.getByTestId('live-finish-confirm').click();
await page.waitForURL(/summary/, { timeout: 30000 });
await page.waitForSelector('text=今日总结', { timeout: 30000 });
check('训练结束生成今日总结', true);

// 导出中文 PDF（真下载）
const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
await page.getByRole('button', { name: /导出今日训练 PDF/ }).first().click();
const download = await downloadPromise;
const path = await download.path();
const { stat, readFile } = await import('node:fs/promises');
const { size } = await stat(path);
const head = (await readFile(path)).subarray(0, 5).toString('latin1');
check('导出中文 PDF 成功', size > 100000 && head === '%PDF-', `${Math.round(size / 1024)} KB, header=${head}`);
await page.screenshot({ path: `${out}/live-summary.png`, fullPage: true });

// 离线可用
await context.setOffline(true);
await page.goto(`${url}/#/`, { waitUntil: 'domcontentloaded' });
const offlineOk = await page
  .getByText('今日计划', { exact: true })
  .isVisible({ timeout: 20000 })
  .catch(() => false);
check('离线状态下仍可打开应用', offlineOk);
await context.setOffline(false);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项检查，失败 ${failed.length} 项`);
process.exit(failed.length ? 1 : 0);
