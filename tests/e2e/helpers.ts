import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Page } from '@playwright/test';

const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');

function regularFontBytes(): Buffer {
  return readFileSync(path.join(FONT_DIR, 'NotoSansSC-Regular.ttf'));
}

/** 生成一份「文字型」中文 PDF，用来测试导入流程 */
export async function makeTextPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(regularFontBytes(), { subset: false });
  const page = doc.addPage([595.28, 841.89]);
  let y = 780;
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 22;
  }
  return Buffer.from(await doc.save());
}

/** 生成一份没有任何文字层的「扫描版」PDF，用来测试 OCR 提示 */
export async function makeScannedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 40, y: 600, width: 500, height: 160, color: rgb(0.85, 0.85, 0.88) });
  page.drawRectangle({ x: 40, y: 400, width: 500, height: 160, color: rgb(0.9, 0.9, 0.92) });
  return Buffer.from(await doc.save());
}

export const SAMPLE_PLAN_TEXT = [
  '健身计划：下肢力量 + 爆发力',
  '日期：2026-09-16',
  '预计训练时间：70 分钟',
  '热身：慢跑 5 分钟；动态拉伸 5 分钟；空杆深蹲 2 组',
  '1. 杠铃深蹲 4组 × 5次 90kg 组间休息 180秒 RPE 8',
  '要领：下蹲到大腿与地面平行，膝盖对准脚尖。注意全程收紧核心。',
  '2. 罗马尼亚硬拉 3组 × 8次 70kg 组间休息 120秒 RPE 7',
  '3. 保加利亚分腿蹲 3组 × 10次 20kg 组间休息 90秒',
  '4. 平板支撑 3组 60秒 组间休息 60秒',
  '拉伸放松：股四头肌、腘绳肌、臀肌各 30 秒 × 2 组；泡沫轴放松大腿前侧 2 分钟。',
];

/**
 * 保证浏览器里有一份可用的训练计划。
 * 说明：v1.3 的一次性数据清理会删除「示例计划」（source: 'sample'），
 * 所以这里注入一份 source: 'manual' 的计划（清理不会删除用户自己创建的计划）。
 */
export async function ensureTrainingPlan(page: Page): Promise<void> {
  await page.goto('/#/');
  // 首次打开会自动执行一次性清理，等它结束（没有该卡片说明已经清理过）
  await page
    .getByTestId('cleanup-result')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);

  await page.evaluate(async () => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('wo-de-xun-lian', 3);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    const now = new Date();
    const date = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
    const plan = {
      id: 'e2e-plan',
      title: 'E2E 测试计划（下肢力量）',
      date,
      kind: 'strength',
      source: 'manual',
      estimatedMinutes: 60,
      warmup: [{ name: '慢跑热身', detail: '5 分钟' }],
      exercises: [
        {
          id: 'e2e-ex-1',
          name: '杠铃深蹲',
          kind: 'strength',
          target: { sets: 4, reps: '5', weightKg: 60, restSec: 60, rpe: 8 },
          order: 0,
          cue: '膝盖对准脚尖',
        },
        {
          id: 'e2e-ex-2',
          name: '罗马尼亚硬拉',
          kind: 'strength',
          target: { sets: 3, reps: '8', weightKg: 50, restSec: 60, rpe: 7 },
          order: 1,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('plans', 'readwrite');
      tx.objectStore('plans').put(plan);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload();
}

/** 断言页面没有横向滚动（iPhone 竖屏关键指标） */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    // 故意可横向滚动的容器（例如分段控件）不算页面溢出
    const insideScroller = (el: HTMLElement): boolean => {
      let node: HTMLElement | null = el.parentElement;
      while (node && node !== body) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
        node = node.parentElement;
      }
      return false;
    };
    const widest = Math.max(
      doc.scrollWidth,
      body.scrollWidth,
      ...Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => !insideScroller(el))
        .map((el) => Math.ceil(el.getBoundingClientRect().right + window.scrollX)),
    );
    return { widest, viewport: window.innerWidth };
  });
  if (overflow.widest > overflow.viewport + 1) {
    throw new Error(
      `页面出现横向溢出：最宽元素 ${overflow.widest}px > 视口 ${overflow.viewport}px`,
    );
  }
}

/** 断言导航与主要按钮的点击区域不小于 44px */
export async function expectTouchTargets(page: Page, selector: string): Promise<void> {
  const small = await page.evaluate((sel) => {
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.height < 44) bad.push(`${el.tagName} ${el.textContent?.trim().slice(0, 12)} → ${Math.round(r.height)}px`);
    });
    return bad;
  }, selector);
  if (small.length) {
    throw new Error(`点击区域小于 44px：\n${small.join('\n')}`);
  }
}
