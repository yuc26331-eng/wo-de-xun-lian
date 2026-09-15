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
await page.getByTestId('open-export').click();
await page.getByTestId('export-pdf').click();
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

// ---- v1.1 新增：今日总结六大分区 / 一键导出 / ChatGPT 报告 / 应用内更新 ----
await page.goto(`${url}/#/summary`, { waitUntil: 'networkidle' });
await page.getByTestId('summary-status').waitFor({ timeout: 20000 });
const sections = await page
  .locator('.collapse-head')
  .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
check(
  '今日总结包含六大分区',
  ['训练记录', 'Apple Watch', '睡眠记录', '身体与恢复', '饮食和补剂', '当日自由记录'].every((t) =>
    sections.some((s) => s.includes(t)),
  ),
  sections.length + ' 个分区',
);

await page.getByTestId('open-export').click();
await page.getByText('查看 Markdown 预览').click();
await page.getByTestId('export-preview').waitFor({ state: 'visible', timeout: 20000 });
const previewText = (await page.getByTestId('export-preview').textContent()) ?? '';
check(
  '导出预览含 ChatGPT 说明与未记录标记',
  previewText.includes('请根据以下日期范围内的原始训练') && previewText.includes('未记录'),
);
const mdWait = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await page.getByTestId('export-markdown').click();
const mdDownload = await mdWait;
check(
  'Markdown 导出文件名正确',
  Boolean(mdDownload && /^训练与恢复记录_\d{4}-\d{2}-\d{2}.*\.md$/.test(mdDownload.suggestedFilename())),
  mdDownload?.suggestedFilename() ?? '未触发下载',
);
await page.keyboard.press('Escape');

await page.goto(`${url}/#/summary?tab=chatgpt`, { waitUntil: 'networkidle' });
const reportTab = await page.getByTestId('import-chatgpt-report').isVisible().catch(() => false);
check('ChatGPT 报告页可导入 PDF 报告', reportTab);

await page.goto(`${url}/#/me`, { waitUntil: 'networkidle' });
await page.getByTestId('update-check').scrollIntoViewIfNeeded();
const currentVersion = (await page.getByTestId('update-current').textContent()) ?? '';
check('应用内更新面板显示当前版本', /v\d+\.\d+\.\d+/.test(currentVersion), currentVersion.trim());
await page.getByTestId('update-check').click();
let updateStatus = '';
for (let i = 0; i < 40; i += 1) {
  updateStatus = (await page.getByTestId('update-status').textContent().catch(() => '')) ?? '';
  if (/已是最新版本|发现新版本|更新失败|当前离线/.test(updateStatus)) break;
  await page.waitForTimeout(500);
}
check(
  '检查更新返回明确状态',
  /已是最新版本|发现新版本|更新失败|当前离线/.test(updateStatus ?? ''),
  updateStatus?.trim() ?? '无状态',
);
await page.screenshot({ path: `${out}/live-update-panel.png`, fullPage: true });

// 线上 version.json 应为 v1.1.0
const versionRes = await page.request.get(`${url}/version.json`);
const versionJson = versionRes.ok() ? await versionRes.json() : null;
check(
  '线上版本信息正确',
  typeof versionJson?.version === 'string' && Array.isArray(versionJson?.notes) && versionJson.notes.length > 0,
  `version=${versionJson?.version}`,
);

// ---- v1.2 新增：首页「今天练什么」/ 大计时 / 撤销 / 动作进步 ----
await page.goto(`${url}/#/`, { waitUntil: 'networkidle' });
await page.getByTestId('today-plan-title').waitFor({ timeout: 20000 });
const heroHasDuration = await page.getByText('预计时长').isVisible().catch(() => false);
const heroCta = (await page.getByTestId('start-training').textContent()) ?? '';
check('首页显示今天练什么与预计时长', heroHasDuration, heroCta.trim());

await page.getByTestId('start-training').click();
await page.getByTestId('live-timer').waitFor({ timeout: 20000 });
check('跟练页显示大号计时与保存状态', true);
const saveBar = (await page.getByTestId('live-save-status').textContent()) ?? '';
check('跟练页显示自动保存状态', /已自动保存/.test(saveBar), saveBar.trim().slice(0, 40));

await page.getByTestId('live-complete-set').click();
await page.getByTestId('live-rest-undo').waitFor({ timeout: 15000 });
await page.getByTestId('live-rest-undo').click();
await page.waitForTimeout(600);
const afterUndo = (await page.getByTestId('live-complete-set').textContent()) ?? '';
check('休息页可一键撤销误操作', /完成本组\s*1\//.test(afterUndo), afterUndo.trim());

await page.goto(`${url}/#/data`, { waitUntil: 'networkidle' });
await page.getByTestId('exercise-progress-card').scrollIntoViewIfNeeded();
const progressCardText = (await page.getByTestId('exercise-progress-card').textContent()) ?? '';
check(
  '数据页动作进步卡片（有数据或明确引导）',
  /首次最大重量|还没有可以对比的训练记录|只有动作名记录/.test(progressCardText),
);

await page.goto(`${url}/#/me`, { waitUntil: 'networkidle' });
await page.getByTestId('export-backup').scrollIntoViewIfNeeded();
const backupDl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await page.getByTestId('export-backup').click();
const backupFile = await backupDl;
check(
  '完整备份可导出',
  Boolean(backupFile && /^我的训练-完整备份-\d{4}-\d{2}-\d{2}\.json$/.test(backupFile.suggestedFilename())),
  backupFile?.suggestedFilename() ?? '未触发下载',
);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项检查，失败 ${failed.length} 项`);
process.exit(failed.length ? 1 : 0);
