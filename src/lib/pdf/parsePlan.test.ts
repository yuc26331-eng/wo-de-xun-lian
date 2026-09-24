import { describe, expect, it } from 'vitest';
import { parsePlanText, parseWeeklyPlanBody, parseTargetFromText } from './parsePlan';
import { PLAN_TEXT, RUN_TEXT, TABLE_TEXT, WEEKLY_TEXT } from './fixtures';

describe('parseTargetFromText', () => {
  it('解析 组数×次数 / 重量 / 休息 / RPE', () => {
    const t = parseTargetFromText('杠铃深蹲 4组×5次 @90kg 休息180秒 RPE8');
    expect(t.sets).toBe(4);
    expect(t.reps).toBe('5');
    expect(t.weightKg).toBe(90);
    expect(t.restSec).toBe(180);
    expect(t.rpe).toBe(8);
  });

  it('解析次数区间、公斤、分钟休息、力竭', () => {
    const t = parseTargetFromText('哑铃肩推 3组×8-12次 重量18公斤 组间休息2分钟 力竭');
    expect(t.sets).toBe(3);
    expect(t.reps).toBe('8-12');
    expect(t.weightKg).toBe(18);
    expect(t.restSec).toBe(120);
  });

  it('解析时间型与跑步字段', () => {
    const t = parseTargetFromText('平板支撑 3组×60秒 休息60秒');
    expect(t.durationSec).toBe(60);
    const run = parseTargetFromText('400米间歇跑 时间90秒 距离0.4公里 配速4:00/km 心率175');
    expect(run.durationSec).toBe(90);
    expect(run.distanceKm).toBeCloseTo(0.4);
    expect(run.paceText).toBe('4:00/km');
    expect(run.hrBpm).toBe(175);
  });

  it('识别自重与百分比重量文本', () => {
    expect(parseTargetFromText('引体向上 3组×8次 自重').weightText).toBe('自重');
    expect(parseTargetFromText('深蹲 5组×3次 80% 1RM').weightText).toBe('80% 1RM');
  });

  it('时间范围与每侧保留为时长，不写进次数', () => {
    const t = parseTargetFromText('哥本哈根侧桥 2-3组 × 25-35秒/侧');
    expect(t.sets).toBe(3);
    expect(t.setsText).toBe('2-3');
    expect(t.durationSec).toBe(35);
    expect(t.durationText).toBe('25-35秒/侧');
    expect(t.durationPerSide).toBe(true);
    expect(t.reps).toBeNull();
  });
});

describe('parsePlanText - 逐行字段排版', () => {
  const draft = parsePlanText(PLAN_TEXT, { importId: 'imp1', fileName: '下肢力量.pdf' });

  it('识别标题、日期与预计时长', () => {
    expect(draft.title).toContain('下肢力量');
    expect(draft.date).toBe('2026-09-15');
    expect(draft.estimatedMinutes).toBe(75);
    expect(draft.sessionKind).toBe('strength');
  });

  it('识别热身内容', () => {
    expect(draft.warmup.length).toBeGreaterThanOrEqual(3);
    expect(draft.warmup.map((w) => w.name).join(' ')).toContain('动态拉伸');
  });

  it('识别 4 个动作及其组次重量休息 RPE', () => {
    expect(draft.exercises).toHaveLength(4);
    const squat = draft.exercises[0];
    expect(squat.name).toBe('杠铃深蹲');
    expect(squat.target.sets).toBe(4);
    expect(squat.target.reps).toBe('5');
    expect(squat.target.weightKg).toBe(90);
    expect(squat.target.restSec).toBe(180);
    expect(squat.target.rpe).toBe(8);
    expect(squat.cue).toContain('大腿与地面平行');
    expect(squat.notes).toContain('核心');

    const rdl = draft.exercises[1];
    expect(rdl.name).toBe('罗马尼亚硬拉');
    expect(rdl.target.weightKg).toBe(70);
    expect(rdl.target.rpe).toBe(7);

    const plank = draft.exercises[3];
    expect(plank.name).toBe('平板支撑');
    expect(plank.target.durationSec).toBe(60);
  });

  it('识别拉伸恢复与备注', () => {
    expect(draft.cooldown).toContain('泡沫轴');
    expect(draft.notes).toContain('睡眠不足');
  });

  it('给出合理的置信度', () => {
    expect(draft.confidence).toBeGreaterThan(0.6);
  });
});

describe('parsePlanText - 解析质量提示', () => {
  it('明显可疑的动作名称和缺失组次会明确提示并降低可信度', () => {
    const draft = parsePlanText(
      `训练计划
日期：2026-09-15
热身
动态拉伸 5分钟
正式训练
1. 热身 3分钟
2. 深蹲
3. 32`,
      { importId: 'bad-plan', fileName: '训练计划.pdf' },
    );

    expect(draft.confidence).toBeLessThanOrEqual(0.45);
    expect(draft.warnings.some((w) => w.includes('动作名称可能'))).toBe(true);
    expect(draft.warnings.some((w) => w.includes('组数/次数'))).toBe(true);
  });
});

describe('parsePlanText - 时长与可靠性', () => {
  it('只有热身时长时，不把热身分钟数当成整堂训练时长', () => {
    const draft = parsePlanText(
      `全身训练计划
日期：2026-09-15
热身 5分钟
正式训练
1. 深蹲 3组 × 10次`,
      { importId: 'warmup-only-time', fileName: '全身训练计划.pdf' },
    );
    expect(draft.estimatedMinutes).toBeNull();
  });
});

describe('parsePlanText - 跑步/足球计划', () => {
  const draft = parsePlanText(RUN_TEXT, { importId: 'imp2', fileName: '间歇跑.pdf' });

  it('识别为跑步类型并解析距离配速心率', () => {
    expect(['run', 'football']).toContain(draft.sessionKind);
    const interval = draft.exercises.find((e) => e.name.includes('间歇跑'));
    expect(interval).toBeTruthy();
    expect(interval?.kind).toBe('run');
    expect(interval?.target.distanceKm).toBeCloseTo(0.4);
    expect(interval?.target.hrBpm).toBe(175);
    const ball = draft.exercises.find((e) => e.name.includes('足球'));
    expect(ball?.kind).toBe('football');
    expect(ball?.target.playMin).toBe(20);
  });

  it('识别日期', () => {
    expect(draft.date).toBe('2026-09-17');
  });
});

describe('parsePlanText - 表格排版', () => {
  const draft = parsePlanText(TABLE_TEXT, { importId: 'imp3', fileName: '今日训练.pdf' });

  it('按表头解析每一行动作', () => {
    expect(draft.exercises).toHaveLength(3);
    const bench = draft.exercises[0];
    expect(bench.name).toBe('杠铃卧推');
    expect(bench.target.sets).toBe(4);
    expect(bench.target.reps).toBe('6');
    expect(bench.target.weightKg).toBe(65);
    expect(bench.target.restSec).toBe(150);
    expect(bench.target.rpe).toBe(8);
    expect(draft.exercises[2].target.weightKg).toBe(25);
  });
});

describe('parseWeeklyPlanBody', () => {
  const { days, warnings } = parseWeeklyPlanBody(WEEKLY_TEXT, {
    importId: 'imp4',
    fileName: '周计划.pdf',
  });

  it('按天拆分并保留动作', () => {
    expect(days.length).toBeGreaterThanOrEqual(4);
    const monday = days[0];
    expect(monday.date).toBe('2026-09-14');
    expect(monday.exercises.length).toBeGreaterThanOrEqual(2);
    const rest = days.find((d) => d.title.includes('周二'));
    expect(rest?.sessionKind).toBe('recovery');
  });

  it('解析出周三与周四的计划', () => {
    const wed = days.find((d) => d.title.includes('周三'));
    expect(wed?.exercises[0]?.name).toContain('卧推');
    const thu = days.find((d) => d.title.includes('周四'));
    expect(thu?.sessionKind).toBe('run');
  });

  it('没有致命警告', () => {
    expect(warnings.filter((w) => w.includes('没有识别到按天'))).toHaveLength(0);
  });
});
