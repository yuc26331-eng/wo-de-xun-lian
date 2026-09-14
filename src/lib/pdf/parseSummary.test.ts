import { describe, expect, it } from 'vitest';
import { parseSummaryText } from './parseSummary';
import { parseBodyReportText, bodyEntriesToMetrics } from './parseBodyReport';
import { BODY_TEXT, SUMMARY_TEXT } from './fixtures';

describe('parseSummaryText', () => {
  const draft = parseSummaryText(SUMMARY_TEXT, { importId: 'imp-s1', fileName: '今日总结.pdf' });

  it('提取日期与体重', () => {
    expect(draft.date).toBe('2026-09-14');
    expect(draft.weightKg).toBeCloseTo(71.6);
  });

  it('提取训练内容与训练量', () => {
    expect(draft.trainingContent).toContain('深蹲');
    expect(draft.trainingVolumeKg).toBe(8420);
  });

  it('提取 RPE、睡眠、饮食、补剂', () => {
    expect(draft.rpe).toBe(8);
    expect(draft.sleepHours).toBeCloseTo(7.2);
    expect(draft.diet).toContain('燕麦');
    expect(draft.supplements?.proteinScoops).toBe(2);
    expect(draft.supplements?.proteinG).toBe(50);
    expect(draft.supplements?.creatineG).toBe(5);
  });

  it('提取疼痛、疲劳与感受', () => {
    expect(draft.pain).toContain('膝');
    expect(draft.fatigue).toBe(6);
    expect(draft.feeling).toContain('状态');
    expect(draft.note).toContain('2.5kg');
  });

  it('置信度较高且没有关键警告', () => {
    expect(draft.confidence).toBeGreaterThan(0.6);
    expect(draft.warnings.filter((w) => w.includes('未识别到训练内容'))).toHaveLength(0);
  });
});

describe('parseBodyReportText', () => {
  const draft = parseBodyReportText(BODY_TEXT, { importId: 'imp-b1', fileName: '身体数据.pdf' });

  it('解析多天数据', () => {
    expect(draft.entries).toHaveLength(3);
    expect(draft.entries[0].date).toBe('2026-09-08');
    expect(draft.entries[0].weightKg).toBeCloseTo(72.8);
    expect(draft.entries[0].bodyFatPct).toBeCloseTo(15.4);
    expect(draft.entries[0].sleepHours).toBeCloseTo(7.5);
    expect(draft.entries[0].restingHr).toBe(58);
  });

  it('可以转换为 BodyMetric 记录', () => {
    const metrics = bodyEntriesToMetrics(draft.entries);
    expect(metrics[0].id).toBe('2026-09-08');
    expect(metrics[2].weightKg).toBeCloseTo(71.6);
  });

  it('识别不到数据时给出警告', () => {
    const empty = parseBodyReportText('今天天气不错', { importId: 'x', fileName: 'a.pdf' });
    expect(empty.entries).toHaveLength(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
});
