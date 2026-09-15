import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReportDraft,
  parseChatGptReportText,
  readReportDraft,
  saveReportDraft,
  stashPendingPdf,
  takePendingPdf,
} from './parseChatGptReport';

const meta = { fileName: 'chatgpt-report.pdf', fileSize: 123456, pageCount: 3, today: '2026-09-15' };

describe('ChatGPT 报告解析', () => {
  it('识别 7 天日期范围（横线 / 波浪线写法）', () => {
    const draft = parseChatGptReportText(
      [
        '训练与恢复分析报告',
        '报告范围：2026-09-10 至 2026-09-16',
        '总体评价',
        '本周训练负荷中等偏高，恢复一般。',
        '建议',
        '把周四的间歇跑减量 20%。',
        '风险提醒',
        '右膝不适需要持续观察，如加重请就医。',
      ].join('\n'),
      meta,
    );
    expect(draft.startDate).toBe('2026-09-10');
    expect(draft.endDate).toBe('2026-09-16');
    expect(draft.title).toContain('报告');
    expect(draft.evaluation).toContain('负荷中等偏高');
    expect(draft.suggestions).toContain('减量');
    expect(draft.risks).toContain('右膝');
    expect(draft.confidence).toBeGreaterThan(0.7);
    expect(draft.warnings.some((w) => w.includes('只识别到一个日期'))).toBe(false);
  });

  it('识别中文日期写法（缺年份时按当前年处理）', () => {
    const draft = parseChatGptReportText(
      '分析报告\n2026年9月10日 — 9月16日\n评价：恢复不错',
      meta,
    );
    expect(draft.startDate).toBe('2026-09-10');
    expect(draft.endDate).toBe('2026-09-16');
  });

  it('识别「最近 7 天」这类相对范围', () => {
    const draft = parseChatGptReportText('最近 7 天训练分析报告\n建议：保持当前节奏', meta);
    expect(draft.startDate).toBe('2026-09-09');
    expect(draft.endDate).toBe('2026-09-15');
    expect(draft.warnings.some((w) => w.includes('最近 7 天'))).toBe(true);
  });

  it('单日报告只识别到一个日期时给出提示，并按单日处理', () => {
    const draft = parseChatGptReportText('单日训练分析\n日期：2026-09-15\n评价：状态很好', meta);
    expect(draft.startDate).toBe('2026-09-15');
    expect(draft.endDate).toBe('2026-09-15');
    expect(draft.warnings.some((w) => w.includes('只识别到一个日期'))).toBe(true);
  });

  it('无法识别日期时提示手动确认，绝不乱填', () => {
    const draft = parseChatGptReportText('这是一份没有写日期的训练分析报告\n建议：多睡觉', meta);
    expect(draft.startDate).toBeNull();
    expect(draft.endDate).toBeNull();
    expect(draft.warnings.some((w) => w.includes('没有识别到日期范围'))).toBe(true);
  });

  it('正文与分区内容分离，保留完整原文', () => {
    const raw = [
      '训练分析报告（2026-09-01 ~ 2026-09-05）',
      '第一天做了深蹲，第二天跑步。',
      '总体评价',
      '训练安排合理。',
      '建议',
      '增加睡眠时间。',
    ].join('\n');
    const draft = parseChatGptReportText(raw, meta);
    expect(draft.bodyText).toContain('第一天做了深蹲');
    expect(draft.bodyText).not.toContain('增加睡眠时间');
    expect(draft.evaluation).toBe('训练安排合理。');
    expect(draft.suggestions).toBe('增加睡眠时间。');
    expect(draft.rawText).toBe(raw);
    expect(draft.summaryText.length).toBeGreaterThan(0);
  });

  it('草稿与待确认 PDF 可以存取（内存 + sessionStorage）', () => {
    const draft = parseChatGptReportText('报告 2026-09-01 ~ 2026-09-03\n建议：继续', meta);
    saveReportDraft(draft);
    const read = readReportDraft();
    expect(read?.startDate).toBe('2026-09-01');
    expect(read?.fileName).toBe('chatgpt-report.pdf');
    clearReportDraft();
    expect(readReportDraft()).toBeNull();

    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    stashPendingPdf(draft.importId, blob);
    expect(takePendingPdf(draft.importId)).toBe(blob);
  });
});

describe('ChatGPT 报告解析 - 边界情况', () => {
  beforeEach(() => clearReportDraft());

  it('空文本不会崩溃，并提示需要手动确认', () => {
    const draft = parseChatGptReportText('', meta);
    expect(draft.startDate).toBeNull();
    expect(draft.warnings.length).toBeGreaterThan(0);
    expect(draft.bodyText).toBe('');
  });

  it('超长文本摘要会被截断但正文保留', () => {
    const long = '很长的分析内容。'.repeat(200);
    const draft = parseChatGptReportText(`报告 2026-09-01 ~ 2026-09-02\n${long}`, meta);
    expect(draft.summaryText.length).toBeLessThanOrEqual(600);
    expect(draft.bodyText.length).toBeGreaterThan(1000);
  });
});
