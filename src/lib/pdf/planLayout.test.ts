import { describe, expect, it } from 'vitest';
import { itemsToLines, type TextItemLike } from './layout';
import { parsePlanText } from './parsePlan';

function item(str: string, x: number, y: number, width = str.length * 9): TextItemLike {
  return { str, transform: [1, 0, 0, 1, x, y], width, height: 9 };
}

/** 模拟卡片 PDF：序号单独在左栏，动作标题/组次/说明在右栏。 */
const CARD_ITEMS: TextItemLike[] = [
  item('30分钟全身力量训练计划', 52, 750, 180),
  item('目标：动作质量优先', 52, 730, 120),
  item('热身 3分钟', 52, 690, 70),
  item('快走 90秒 + 动态拉伸 20秒', 52, 675, 180),
  item('1', 34, 600),
  item('罗马尼亚硬拉', 70, 620, 90),
  item('4组 x 6次', 70, 610, 60),
  item('髋关节后移，保持背部中立。', 70, 596, 180),
  item('2', 34, 540),
  item('哑铃卧推', 70, 560, 72),
  item('3组 x 10次', 70, 550, 64),
  item('肩胛稳定，匀速下放。', 70, 536, 150),
  item('3', 34, 480),
  item('高位下拉', 70, 500, 72),
  item('3组 x 12次', 70, 490, 64),
  item('不要耸肩。', 70, 476, 72),
  item('4', 34, 420),
  item('保加利亚分腿蹲', 70, 440, 108),
  item('3组 x 8次/侧', 70, 430, 74),
  item('前脚踩稳，膝盖对齐脚尖。', 70, 416, 160),
  item('5', 34, 360),
  item('平板支撑', 70, 380, 72),
  item('2-3组 x 25-35秒/侧', 70, 370, 84),
  item('核心收紧，不塌腰。', 70, 356, 120),
  item('收尾 2分钟', 52, 310, 70),
  item('呼吸 5次 + 轻拉伸。', 52, 296, 120),
  item('全身训练/30分钟/5个主动作2026-09-15', 52, 28, 260),
];

describe('卡片式训练计划 PDF 布局', () => {
  it('把左侧序号并回动作标题，不把序号或热身/收尾当动作', () => {
    const lines = itemsToLines(CARD_ITEMS);
    expect(lines[0]).toBe('30分钟全身力量训练计划');
    expect(lines).toContain('1. 罗马尼亚硬拉');
    expect(lines).toContain('5. 平板支撑');
    expect(lines).not.toContain('1');
    expect(lines).not.toContain('2');
  });

  it('解析出正确标题、日期、5 个动作及组次', () => {
    const draft = parsePlanText(itemsToLines(CARD_ITEMS).join('\n'), {
      importId: 'card-plan',
      fileName: '30分钟全身力量训练计划.pdf',
    });

    expect(draft.title).toBe('30分钟全身力量训练计划');
    expect(draft.date).toBe('2026-09-15');
    expect(draft.estimatedMinutes).toBe(30);
    expect(draft.exercises).toHaveLength(5);
    expect(draft.exercises.map((e) => e.name)).toEqual([
      '罗马尼亚硬拉',
      '哑铃卧推',
      '高位下拉',
      '保加利亚分腿蹲',
      '平板支撑',
    ]);
    expect(draft.exercises.map((e) => [e.target.sets, e.target.reps])).toEqual([
      [4, '6'],
      [3, '10'],
      [3, '12'],
      [3, '8'],
      [3, null],
    ]);
    expect(draft.exercises[4].target.setsText).toBe('2-3');
    expect(draft.exercises[4].target.durationSec).toBe(35);
    expect(draft.exercises[4].target.durationText).toBe('25-35秒/侧');
    expect(draft.warmup).toHaveLength(1);
    expect(draft.cooldown).toContain('呼吸 5次');
    expect(draft.confidence).toBeGreaterThan(0.9);
    expect(draft.warnings).toHaveLength(0);
  });
});

describe('双列与混合编号的匿名样例', () => {
  it('左右双列卡片按列切分，动作不串列也不漏项', () => {
    const items: TextItemLike[] = [
      item('双列核心训练计划', 42, 750, 150),
      item('热身 5分钟', 42, 710, 70),
      item('动态拉伸', 42, 696, 60),
      item('1', 20, 610),
      item('左列死虫式', 56, 630, 80),
      item('3组 x 10次/侧', 56, 620, 76),
      item('左侧动作说明。', 56, 606, 90),
      item('2', 20, 520),
      item('左列鸟狗式', 56, 540, 80),
      item('3组 x 8次/侧', 56, 530, 72),
      item('左侧第二动作说明。', 56, 516, 100),
      item('1', 320, 610),
      item('右列平板支撑', 356, 630, 90),
      item('3组 x 30秒', 356, 620, 68),
      item('右侧动作说明。', 356, 606, 90),
      item('2', 320, 520),
      item('右列侧桥', 356, 540, 72),
      item('3组 x 25秒/侧', 356, 530, 76),
      item('右侧第二动作说明。', 356, 516, 100),
      item('核心训练/20分钟/4个主动作2026-09-15', 42, 28, 260),
    ];
    const lines = itemsToLines(items);
    expect(lines).toContain('1. 左列死虫式');
    expect(lines).toContain('1. 右列平板支撑');
    expect(lines).toContain('2. 左列鸟狗式');
    expect(lines).toContain('2. 右列侧桥');

    const draft = parsePlanText(lines.join('\n'), {
      importId: 'two-column',
      fileName: '双列核心训练计划.pdf',
    });
    expect(draft.exercises.map((e) => e.name)).toEqual([
      '左列死虫式',
      '右列平板支撑',
      '左列鸟狗式',
      '右列侧桥',
    ]);
    expect(draft.exercises.map((e) => e.target.reps)).toEqual(['10', null, '8', null]);
    expect(draft.exercises[1].target.durationText).toBe('30秒');
    expect(draft.exercises[3].target.durationText).toBe('25秒/侧');
    expect(draft.confidence).toBeGreaterThan(0.9);
    expect(draft.warnings).toHaveLength(0);
  });

  it('前两个有编号、第三个无编号时仍切成三个动作', () => {
    const draft = parsePlanText(
      `混合编排力量计划
日期：2026-09-15
热身
快走 5分钟
正式训练
1. 高脚杯深蹲
3组 x 10次
2. 反向弓步
3组 x 8次/侧
臀桥
3组 x 12次`,
      { importId: 'mixed-numbering', fileName: '混合编排力量计划.pdf' },
    );
    expect(draft.exercises.map((e) => e.name)).toEqual(['高脚杯深蹲', '反向弓步', '臀桥']);
    expect(draft.exercises.map((e) => e.target.sets)).toEqual([3, 3, 3]);
    expect(draft.confidence).toBeLessThanOrEqual(0.85);
    expect(draft.warnings.some((w) => w.includes('混合编号'))).toBe(true);
  });

  it('组次目标和动作数不一致时降低可信度', () => {
    const draft = parsePlanText(
      `不确定编排计划
日期：2026-09-15
1. 深蹲
3组 x 10次
2. 卧推
3组 x 8次
此段无法可靠判断是否是新动作
3组 x 12次`,
      { importId: 'uncertain-layout', fileName: '不确定编排计划.pdf' },
    );
    expect(draft.confidence).toBeLessThanOrEqual(0.85);
    expect(draft.warnings.some((w) => w.includes('混合编号') || w.includes('只整理出'))).toBe(true);
  });
});
