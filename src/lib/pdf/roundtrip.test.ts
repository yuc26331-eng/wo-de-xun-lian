/**
 * 端到端回归：用 pdf-lib 生成一份中文 PDF -> 用 pdf.js 读回文字 -> 解析成计划草稿。
 * 这一步同时验证了「中文字体能被正确嵌入且可抽出文字」这一关键链路。
 * 运行环境为 jsdom（与全局 setup 一致），pdf.js 用 legacy 构建以便在无 Worker 情况下解析。
 */
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { itemsToLines, type TextItemLike } from './layout';
import { parsePlanText } from './parsePlan';
import { parseSummaryText } from './parseSummary';
import { classifyPdf } from './classify';
import { PLAN_TEXT, SUMMARY_TEXT } from './fixtures';

type PdfjsModule = {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
    }>;
  };
};

let fontBytes: Uint8Array;

beforeAll(async () => {
  fontBytes = new Uint8Array(await readFile('public/fonts/NotoSansSC-Regular.ttf'));
});

/** 把纯文本渲染成 PDF（每行一次 drawText，模拟真实排版） */
async function makePdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // 注意：这里必须 subset:false —— 子集化在 Noto 上会产出无效字体（导出侧同样处理）
  const font = await doc.embedFont(fontBytes, { subset: false });
  const lines = text.split('\n');
  const perPage = 40;
  for (let p = 0; p * perPage < lines.length; p += 1) {
    const page = doc.addPage([595.28, 841.89]);
    let y = 800;
    for (const line of lines.slice(p * perPage, (p + 1) * perPage)) {
      if (line.trim()) page.drawText(line, { x: 44, y, size: 11, font });
      y -= 18;
    }
  }
  return doc.save();
}

async function extractText(bytes: Uint8Array): Promise<string> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[]; width?: number; height?: number }[])
      .filter((it) => typeof it.str === 'string')
      .map<TextItemLike>((it) => ({
        str: it.str as string,
        transform: it.transform ?? [1, 0, 0, 1, 0, 0],
        width: it.width,
        height: it.height,
      }));
    pages.push(itemsToLines(items).join('\n'));
  }
  return pages.join('\n');
}

describe('PDF 往返：生成 -> 读取 -> 解析', () => {
  it('中文文字能被完整读出（不乱码、不丢字）', async () => {
    const bytes = await makePdf(PLAN_TEXT);
    const text = await extractText(bytes);
    expect(text).toContain('下肢力量');
    expect(text).toContain('杠铃深蹲');
    expect(text).toContain('泡沫轴');
    expect(text).toContain('睡眠不足');
    // 中文标点也应该保留
    expect(text).toContain('、');
  });

  it('从真实 PDF 解析出结构化的健身计划', async () => {
    const bytes = await makePdf(PLAN_TEXT);
    const text = await extractText(bytes);
    expect(classifyPdf(text, 'plan.pdf').kind).toBe('plan');
    const draft = parsePlanText(text, { importId: 'rt1', fileName: '下肢力量.pdf' });
    expect(draft.date).toBe('2026-09-15');
    expect(draft.exercises.length).toBeGreaterThanOrEqual(4);
    const squat = draft.exercises[0];
    expect(squat.name).toContain('深蹲');
    expect(squat.target.sets).toBe(4);
    expect(squat.target.weightKg).toBe(90);
    expect(squat.target.restSec).toBe(180);
    expect(squat.target.rpe).toBe(8);
    expect(draft.cooldown).toContain('泡沫轴');
  });

  it('从真实 PDF 解析出今日总结', async () => {
    const bytes = await makePdf(SUMMARY_TEXT);
    const text = await extractText(bytes);
    expect(classifyPdf(text, 'summary.pdf').kind).toBe('daily-summary');
    const draft = parseSummaryText(text, { importId: 'rt2', fileName: '总结.pdf' });
    expect(draft.date).toBe('2026-09-14');
    expect(draft.weightKg).toBeCloseTo(71.6);
    expect(draft.trainingVolumeKg).toBe(8420);
    expect(draft.rpe).toBe(8);
    expect(draft.pain).toContain('膝');
  });

  it('扫描版（无文字层）会被判定为需要 OCR', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    const bytes = await doc.save();
    const text = await extractText(bytes);
    expect(text.replace(/\s/g, '').length).toBeLessThan(10);
    expect(classifyPdf(text, 'scan.pdf').kind).toBe('unknown');
  });
});
