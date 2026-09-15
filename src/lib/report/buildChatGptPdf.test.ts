import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_INCLUDE,
  buildRangeData,
  buildRangeSummary,
  type ExportContext,
} from './chatgptExport';
import { buildChatGptRangePdf, dayBlocks, pdfFileName, pdfHasTextLayer } from './buildChatGptPdf';

const OUT = resolve(process.cwd(), '..', 'work', 'out');

const ctx: ExportContext = {
  dailyLogs: [
    {
      id: '2026-09-15',
      date: '2026-09-15',
      training: { items: '下肢力量', exercises: '杠铃深蹲 4组×5次 90kg', rpe: 8 },
      watch: { steps: 9123, restingHr: 52, hrvMs: 64, activeEnergyKcal: 620 },
      sleep: { totalHours: 7.3, deepHours: 1.2, quality: 4 },
      body: { weightKg: 71.4, fatigue: 4, injuryPain: '右膝轻微不适', overall: '整体不错' },
      meals: { breakfast: '燕麦鸡蛋', dinner: '牛肉意面', waterMl: 2600 },
      supplements: { proteinG: 50, creatineG: 5 },
      freeNote: '右膝在深蹲最后两组有轻微不适，没有加重。',
      createdAt: '',
      updatedAt: '',
    },
  ],
  summaries: [],
  bodyMetrics: [],
  attachments: [],
};

function loadFonts() {
  const toU8 = (p: string) => {
    const buf = readFileSync(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
  return {
    regular: toU8(resolve(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf')),
    bold: toU8(resolve(process.cwd(), 'public/fonts/NotoSansSC-Bold.ttf')),
  };
}

describe('给 ChatGPT 的分析报告 PDF', () => {
  beforeAll(() => mkdirSync(OUT, { recursive: true }));

  it('生成带文字层的中文 PDF（可复制、可搜索、含未记录标记）', async () => {
    const days = buildRangeData('2026-09-13', '2026-09-16', ctx);
    const summary = buildRangeSummary(days);
    const bytes = await buildChatGptRangePdf({ days, include: DEFAULT_INCLUDE, summary }, loadFonts());

    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    // 内嵌中文字体后体积明显变大，说明字体真的写进了文件
    expect(bytes.byteLength).toBeGreaterThan(700_000);
    expect(await pdfHasTextLayer(bytes)).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    writeFileSync(resolve(OUT, 'chatgpt-range-report.pdf'), bytes);
  });

  it('每一天拆成六个分区，缺项写未记录', () => {
    const days = buildRangeData('2026-09-13', '2026-09-16', ctx);
    const blocks = dayBlocks(
      days.find((d) => d.date === '2026-09-15') ?? days[days.length - 1],
      DEFAULT_INCLUDE,
    );
    const titles = blocks.map((b) => b.title);
    expect(titles).toEqual([
      '训练情况',
      'Apple Watch 与运动数据',
      '睡眠情况',
      '身体与恢复',
      '饮食与补剂',
      '用户备注（原话）',
    ]);
    const watch = blocks.find((b) => b.title === 'Apple Watch 与运动数据')!;
    expect(watch.lines.some((l) => l.includes('步数：9123'))).toBe(true);
    expect(watch.lines.some((l) => l.includes('血氧：未记录'))).toBe(true);
    const notes = blocks.find((b) => b.title === '用户备注（原话）')!;
    expect(notes.lines[0]).toContain('右膝在深蹲最后两组有轻微不适');
  });

  it('文件名使用训练与恢复记录_开始_结束.pdf', () => {
    expect(pdfFileName('2026-09-10', '2026-09-16')).toBe(
      '训练与恢复记录_2026-09-10_2026-09-16.pdf',
    );
  });
});
