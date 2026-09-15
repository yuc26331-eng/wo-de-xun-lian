import { describe, expect, it } from 'vitest';
import {
  classifyHealthText,
  mergeWatchAnalyses,
  normalizeOcrText,
  parseActivityText,
  parseDurationToMinutes,
  parseSleepText,
  parseWatchText,
  parseWorkoutText,
  sleepDurationText,
} from './parse';

// ------------------------------------------------------------------
// 下面几段文字是「真实 tesseract.js（chi_sim + eng）识别 Apple 健身 / 健康截图」
// 得到的原始输出，保留了真实 OCR 瑕疵：汉字间插空格、干/千混读、斜杠被吃掉、
// "1:42:12" 被读成 "142:12"、状态栏时间、图表坐标、目标值等。
// 数值做了替换（同样的排版、同样的 OCR 错误），不含个人健康数据。
// ------------------------------------------------------------------

// 健身摘要（圆环卡片）：活动 1,232/2,000 千卡、锻炼 65/25 分钟、站立 12/8 小时、步数、步行距离
const SUMMARY_OCR = `21:07 2 会 人 @57
健身 圆 环
活动
1,232/2,000 干 卡
锻炼
65/25 分 钟
站 立
1218 4 时
步 数 步行 距离
今天 今天
9,876 7.65 公里
训练 与 练习
户外 足球
5.05 公 里
摘要 Fitness+ 体能 训练 共 亭`;

// 活动详情：站立 12/8 小时、步数 9,876、距离 7.65、共 3,120 千卡（总消耗）
const ACTIVITY_OCR = `01:06 丁 2 全 区 7
站 立
12/8 小 时
oo.00 06:00 12:00 18:00
10 小 时 未 站 立
步 数 距离
9,876 7.65 公 里
已 爬 楼 层
5
共 3,120 千卡
训练
功能 性 力量 训练
574 干 卡`;

// 体能训练详情（力量）
const WORKOUT_OCR = `21:07 2 会 @sf
功能 性 力量 训练
09:33-10:32
体能 训练 时 间 动态 干 卡
0:59:49 415 干 卡
总 干 卡 数 平均 心率
593 干 卡 101 次 /分
耗 能 二
心率 >
132
平均 101 次 /分`;

// 体能训练详情（足球）：OCR 把 1:42:12 读成 142:12、1223/1528 的千分位丢了
const WORKOUT_FOOTBALL_OCR = `21:07 2 全 E@E57
户外 必 球
16:32-18:14
体能 训练 时 间 距离
142:12 5.05 公里
动态 干 卡 总 干 卡 数
1223 干 卡 1528 干 卡
平均 心率
126 次 /分
心率 >
186
89
平均 12G 1 分`;

// 睡眠（健康 - 日视图）：睡眠时间 5 小时 1 分钟 + 各分期；图表坐标与状态栏时间都在
const SLEEP_OCR = `21:07 :1 会 E55
睡眠 义
睡眠 时 间
5 小 时 1 分 钟 1
2026 年 8 月 4 日
清醒 时 间
快速 动 眼 睡 上 中 |
核心 睡眠 |
深度 睡眠
02:00 04:00 06:00 08:00
ED se
全 清醒 时 间 18 分 钟
@@ 快速 动 眼 睡 眠 1 小 时 3 分 钟
外 核心 睡眠 3 小 时 15 分 钟
” 深度 睡眠 43 分 钟`;

describe('文本预处理与数字', () => {
  it('全角转半角、去掉多余空格与竖线', () => {
    expect(normalizeOcrText('１２３：４５ ｜ ６７８')).toBe('123:45 678');
  });

  it('干卡 → 千卡、汉字间空格合并', () => {
    expect(normalizeOcrText('活动 能 量 1,232 干 卡')).toBe('活动能量 1,232 千卡');
  });
});

describe('截图类型判断', () => {
  it('睡眠 / 全天活动 / 单次训练能区分开', () => {
    expect(classifyHealthText(SLEEP_OCR)).toBe('sleep');
    expect(classifyHealthText(SUMMARY_OCR)).toBe('activity');
    expect(classifyHealthText(ACTIVITY_OCR)).toBe('activity');
    expect(classifyHealthText(WORKOUT_OCR)).toBe('workout');
    expect(classifyHealthText('今天天气不错\n随便写点东西')).toBe('unknown');
  });
});

describe('全天活动截图（摘要 / 活动详情）', () => {
  it('目标值 "1,232/2,000 千卡" 只取实际值 1232，目标单独记录', () => {
    const a = parseActivityText(SUMMARY_OCR);
    expect(a.fields.activeEnergyKcal?.value).toBe(1232);
    expect(a.fields.activeEnergyKcal?.goal).toBe(2000);
    expect(a.fields.exerciseMinutes?.value).toBe(65);
    expect(a.fields.exerciseMinutes?.goal).toBe(25);
  });

  it('站立 "1218 4 时"（斜杠被吃掉）按 12/8 修复并标记待确认', () => {
    const a = parseActivityText(SUMMARY_OCR);
    expect(a.fields.standHours?.value).toBe(12);
    expect(a.fields.standHours?.goal).toBe(8);
    expect(a.pendingFields).toContain('站立小时');
  });

  it('合并卡片里的步数与距离不会粘成一个数（9,876 / 7.65）', () => {
    const a = parseActivityText(SUMMARY_OCR);
    expect(a.fields.steps?.value).toBe(9876);
    expect(a.fields.distanceKm?.value).toBe(7.65);
  });

  it('活动详情：站立取实际值、总消耗来自 "共 3,120 千卡"', () => {
    const a = parseActivityText(ACTIVITY_OCR);
    expect(a.fields.standHours?.value).toBe(12);
    expect(a.fields.standHours?.goal).toBe(8);
    expect(a.fields.steps?.value).toBe(9876);
    expect(a.fields.distanceKm?.value).toBe(7.65);
    expect(a.fields.totalEnergyKcal?.value).toBe(3120);
    // "10 小时未站立" 这种文字不能被当成任何时长
    expect(a.fields.exerciseMinutes).toBeUndefined();
  });

  it('没有有效数据时 status=empty，并给出上传建议', () => {
    const a = parseActivityText('早餐：两个鸡蛋\n午餐：米饭');
    expect(a.status).toBe('empty');
    expect(a.warnings[0]).toContain('没提取到全天活动数据');
  });

  it('真实浏览器 OCR 把单位读成乱码时（"2,575/2,000 F+«"）仍取实际值并标记待确认', () => {
    const broken = SUMMARY_OCR.replace('1,232/2,000 干 卡', '1,232/2,000 F+«').replace(
      '65/25 分 钟',
      '65/25 54',
    );
    const a = parseActivityText(broken);
    expect(a.fields.activeEnergyKcal?.value).toBe(1232);
    expect(a.fields.activeEnergyKcal?.goal).toBe(2000);
    expect(a.fields.activeEnergyKcal?.pending).toBe(true);
    expect(a.fields.exerciseMinutes?.value).toBe(65);
    expect(a.pendingFields).toContain('activeEnergyKcal');
  });
});

describe('单次训练截图（体能训练详细信息）', () => {
  it('时长 / 动态 / 总消耗 / 平均心率 / 开始时间都正确', () => {
    const a = parseWorkoutText(WORKOUT_OCR);
    expect(a.workoutFields.startTime?.value).toBe('09:33');
    expect(a.workoutFields.durationMin?.value).toBe(59.8);
    expect(a.workoutFields.kcal?.value).toBe(415);
    expect(a.workoutFields.totalKcal?.value).toBe(593);
    expect(a.workoutFields.avgHr?.value).toBe(101);
    // 图表上的孤立的 132 不能当成最高心率
    expect(a.workoutFields.maxHr).toBeUndefined();
  });

  it('OCR 把 1:42:12 读成 "142:12" 时也能还原（102.2 分钟，标记待确认）', () => {
    const a = parseWorkoutText(WORKOUT_FOOTBALL_OCR);
    expect(a.workoutFields.durationMin?.value).toBe(102.2);
    expect(a.workoutFields.durationMin?.pending).toBe(true);
    expect(a.pendingFields).toContain('训练时长');
    expect(a.workoutFields.distanceKm?.value).toBe(5.05);
    expect(a.workoutFields.kcal?.value).toBe(1223);
    expect(a.workoutFields.totalKcal?.value).toBe(1528);
    expect(a.workoutFields.avgHr?.value).toBe(126);
    expect(a.workoutFields.startTime?.value).toBe('16:32');
  });

  it('动态千卡的单位被读成 FF 时，动态消耗与总消耗不会互换', () => {
    const broken = `功能 性 力量 训练
09:33-10:32
体能 训练 时 间 ATF
0:59:49 415 FF
总 干 卡 数 平均 心率
593 干 卡 101 次 /分`;
    const a = parseWorkoutText(broken);
    expect(a.workoutFields.kcal?.value).toBe(415);
    expect(a.workoutFields.totalKcal?.value).toBe(593);
    expect(a.workoutFields.avgHr?.value).toBe(101);
    expect(a.workoutFields.durationMin?.value).toBe(59.8);
    expect(a.pendingFields).toContain('动态消耗');
  });

  it('parseDurationToMinutes 覆盖常见写法', () => {
    expect(parseDurationToMinutes('1:42:12')?.minutes).toBe(102.2);
    expect(parseDurationToMinutes('0:59:49')?.minutes).toBe(59.8);
    expect(parseDurationToMinutes('142:12')?.minutes).toBe(102.2);
    expect(parseDurationToMinutes('45:00')?.minutes).toBe(45);
    expect(parseDurationToMinutes('1:30')?.minutes).toBe(90);
    expect(parseDurationToMinutes('abc')).toBeNull();
  });
});

describe('睡眠截图', () => {
  it('睡眠时间 5 小时 1 分钟 → 5.02 小时，显示为「5小时1分钟」', () => {
    const r = parseSleepText(SLEEP_OCR);
    expect(r.sleep.totalHours).toBeCloseTo(5.02, 2);
    expect(sleepDurationText(r.sleep.totalHours)).toBe('5小时1分钟');
    expect(r.status).toBe('ok');
  });

  it('各睡眠分期正确（深度/核心/REM/清醒），不把清醒算进睡眠', () => {
    const r = parseSleepText(SLEEP_OCR);
    expect(r.sleep.deepHours).toBeCloseTo(0.72, 2);
    expect(r.sleep.coreHours).toBeCloseTo(3.25, 2);
    expect(r.sleep.remHours).toBeCloseTo(1.05, 2);
    expect(r.sleep.awakeHours).toBeCloseTo(0.3, 2);
  });

  it('没有"就寝/起床"标签或时间范围时留空，绝不拿状态栏或坐标轴时间', () => {
    const r = parseSleepText(SLEEP_OCR);
    expect(r.sleep.sleepTime).toBeUndefined();
    expect(r.sleep.wakeTime).toBeUndefined();
    expect(r.hints.join(' ')).toContain('没有明确标注入睡/起床时间');
  });

  it('长截图里混着活动数据时，站立 15 小时不会被当成睡眠时长', () => {
    const mixed = `${ACTIVITY_OCR}\n站 立\n15 小 时 未 站 立\n${SLEEP_OCR}`;
    const r = parseSleepText(mixed);
    expect(r.sleep.totalHours).toBeCloseTo(5.02, 2);
  });

  it('周/月视图或异常数值（15 小时）不采用，留空并提示核对', () => {
    const weekView = `睡眠\n本周平均\n15 小时 12 分钟\n周 月 6个月`;
    const r = parseSleepText(weekView);
    expect(r.sleep.totalHours).toBeUndefined();
    expect(r.warnings.join(' ')).toContain('超出正常单日范围');
    expect(r.status).toBe('empty');
  });

  it('明确写了睡眠时间范围时可以用（跨零点）', () => {
    const r = parseSleepText('睡眠\n7小时18分\n23:50 - 07:10\n核心 4小时12分\n深度 1小时05分');
    expect(r.sleep.sleepTime).toBe('23:50');
    expect(r.sleep.wakeTime).toBe('07:10');
    expect(r.sleep.totalHours).toBeCloseTo(7.3, 1);
    expect(r.sleep.coreHours).toBeCloseTo(4.2, 1);
  });

  it('分期合计远大于总时长时标记待确认', () => {
    const r = parseSleepText('睡眠时间\n5 小时 0 分钟\n核心睡眠 6 小时 0 分钟\n深度睡眠 3 小时 0 分钟');
    expect(r.pendingFields).toContain('总睡眠时长');
    expect(r.warnings.join(' ')).toContain('对不上');
  });

  it('没有识别到内容时给出警告而不是填 0', () => {
    const r = parseSleepText('一张和睡眠无关的图片');
    expect(Object.keys(r.sleep)).toHaveLength(0);
    expect(r.status).toBe('empty');
    expect(r.warnings[0]).toContain('没提取到睡眠数据');
  });
});

describe('统一入口与多图合并', () => {
  it('parseWatchText 会按类型分派（训练截图填 workoutFields）', () => {
    const a = parseWatchText(WORKOUT_OCR);
    expect(a.kind).toBe('workout');
    expect(a.workoutFields.kcal?.value).toBe(415);
    const b = parseWatchText(SUMMARY_OCR);
    expect(b.kind).toBe('activity');
    expect(b.fields.activeEnergyKcal?.value).toBe(1232);
  });

  it('睡眠截图误传到手表步骤时给出提示而不是硬填', () => {
    const a = parseWatchText(SLEEP_OCR);
    expect(a.kind).toBe('sleep');
    expect(Object.keys(a.fields)).toHaveLength(0);
    expect(a.warnings.join(' ')).toContain('睡眠截图');
  });

  it('多张截图合并：同名指标取最大值，不重复累加，重复截图被识别', () => {
    const a1 = parseActivityText(SUMMARY_OCR);
    const a2 = parseActivityText('活动能量 300 千卡\n锻炼 20 分钟');
    const dup = parseActivityText(SUMMARY_OCR);
    const merged = mergeWatchAnalyses([a1, a2, dup]);
    expect(merged.merged.activeEnergyKcal).toBe(1232); // 取最大，而不是 1232+300
    expect(merged.duplicates).toBe(1);
    expect(merged.usedScreenshots).toBe(2);
    expect(merged.notes.join(' ')).toContain('不重复计算');
  });

  it('英文摘要截图同样可用（bpm / steps）', () => {
    const a = parseActivityText(
      'Summary\nActive Energy\n480 kcal\nExercise\n32 min\nStand\n9 hr\nSteps\n6100 steps\nHeart Rate\nAvg 118 bpm\nResting 55 bpm',
    );
    expect(a.fields.activeEnergyKcal?.value).toBe(480);
    expect(a.fields.exerciseMinutes?.value).toBe(32);
    expect(a.fields.standHours?.value).toBe(9);
    expect(a.fields.steps?.value).toBe(6100);
    expect(a.fields.avgHr?.value).toBe(118);
    expect(a.fields.restingHr?.value).toBe(55);
  });
});
