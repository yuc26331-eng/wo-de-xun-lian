import { describe, expect, it } from 'vitest';
import { classifyPdf } from './classify';
import { itemsToLines, pagesToText } from './layout';
import { diffDailyLog, draftToDailyLogPatch, findDuplicateImport } from './draft';
import { parseSummaryText } from './parseSummary';
import {
  BODY_TEXT,
  PLAN_TEXT,
  RUN_TEXT,
  SCANNED_TEXT,
  SUMMARY_TEXT,
  TABLE_TEXT,
  WEEKLY_TEXT,
} from './fixtures';
import type { DailyLog, PdfImportRecord } from '../../types';

describe('classifyPdf', () => {
  it('区分健身计划 / 今日总结 / 周计划 / 身体数据', () => {
    expect(classifyPdf(PLAN_TEXT, '下肢力量.pdf').kind).toBe('plan');
    expect(classifyPdf(SUMMARY_TEXT, '今日训练总结.pdf').kind).toBe('daily-summary');
    expect(classifyPdf(WEEKLY_TEXT, '周训练计划.pdf').kind).toBe('weekly-plan');
    expect(classifyPdf(BODY_TEXT, '身体数据报告.pdf').kind).toBe('body-report');
  });

  it('主要看内容而不是文件名', () => {
    expect(classifyPdf(PLAN_TEXT, '扫描件001.pdf').kind).toBe('plan');
    expect(classifyPdf(RUN_TEXT, 'a.pdf').kind).toBe('plan');
  });

  it('内容不足时返回 unknown', () => {
    expect(classifyPdf(SCANNED_TEXT, 'x.pdf').kind).toBe('unknown');
  });
});

describe('itemsToLines（PDF 文字布局还原）', () => {
  it('按 y 分行、按 x 排序，中文之间不插空格，英文之间插空格', () => {
    const items = [
      { str: '杠铃深蹲', transform: [1, 0, 0, 1, 40, 700], width: 48 },
      { str: '4组', transform: [1, 0, 0, 1, 96, 700], width: 24 },
      { str: 'RPE', transform: [1, 0, 0, 1, 130, 700], width: 20 },
      { str: '8', transform: [1, 0, 0, 1, 155, 700], width: 8 },
      { str: '第二行', transform: [1, 0, 0, 1, 40, 660], width: 36 },
    ];
    const lines = itemsToLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('杠铃深蹲 4组 RPE 8');
    expect(lines[1]).toBe('第二行');
  });

  it('pagesToText 拼接多页', () => {
    expect(pagesToText(['a', 'b'])).toBe('a\nb');
  });
});

describe('合并预览 diffDailyLog', () => {
  const draft = parseSummaryText(SUMMARY_TEXT, { importId: 'imp-x', fileName: '总结.pdf' });
  const patch = draftToDailyLogPatch(draft);

  it('草稿转换为可写入字段', () => {
    expect(patch.date).toBe('2026-09-14');
    expect(patch.weightKg).toBeCloseTo(71.6);
    expect(patch.source).toBe('pdf');
    expect(patch.summaryId).toBe('imp-x');
  });

  it('没有旧记录时全部是新增', () => {
    const diff = diffDailyLog(null, draft);
    expect(diff.creates.length).toBeGreaterThan(5);
    expect(diff.updates).toHaveLength(0);
    expect(diff.targetId).toBe('2026-09-14');
  });

  it('已有记录时区分新增/修改/不变', () => {
    const existing: DailyLog = {
      id: '2026-09-14',
      date: '2026-09-14',
      weightKg: 72,
      trainingContent: '旧内容',
      rpe: 8,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    };
    const diff = diffDailyLog(existing, draft);
    expect(diff.updates.some((u) => u.label === '体重')).toBe(true);
    expect(diff.updates.some((u) => u.label === '训练内容')).toBe(true);
    expect(diff.unchanged).toContain('RPE');
    expect(diff.creates.some((c) => c.label === '训练量')).toBe(true);
    expect(diff.conflicts).toHaveLength(0);
  });

  it('同一份 PDF 重复导入会提示冲突', () => {
    const existing: DailyLog = {
      id: '2026-09-14',
      date: '2026-09-14',
      summaryId: 'imp-x',
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    };
    const diff = diffDailyLog(existing, draft, { duplicateImport: true });
    expect(diff.conflicts.length).toBeGreaterThanOrEqual(2);
  });

  it('完全一致时提示无需保存', () => {
    const same: DailyLog = {
      id: '2026-09-14',
      date: '2026-09-14',
      ...patch,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    } as DailyLog;
    const diff = diffDailyLog(same, draft);
    expect(diff.conflicts.some((c) => c.includes('完全一致'))).toBe(true);
  });
});

describe('findDuplicateImport', () => {
  const records: PdfImportRecord[] = [
    {
      id: 'p1',
      fileName: '下肢力量.pdf',
      fileSize: 120000,
      pageCount: 1,
      importedAt: '2026-09-15T00:00:00.000Z',
      kind: 'plan',
      pages: [],
      text: '',
      ocrRequired: false,
      saved: true,
    },
  ];

  it('同名同大小且已保存时判定为重复', () => {
    expect(findDuplicateImport(records, '下肢力量.pdf', 120500)?.id).toBe('p1');
    expect(findDuplicateImport(records, '下肢力量.pdf', 999)).toBeNull();
    expect(findDuplicateImport(records, '其他.pdf', 120000)).toBeNull();
  });
});

describe('表格型计划分类', () => {
  it('表格文本也能识别为计划', () => {
    expect(classifyPdf(TABLE_TEXT, '今日训练.pdf').kind).toBe('plan');
  });
});
