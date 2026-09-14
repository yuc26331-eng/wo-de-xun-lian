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

/** 断言页面没有横向滚动（iPhone 竖屏关键指标） */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const widest = Math.max(
      doc.scrollWidth,
      body.scrollWidth,
      ...Array.from(document.querySelectorAll<HTMLElement>('body *')).map((el) =>
        Math.ceil(el.getBoundingClientRect().right + window.scrollX),
      ),
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
