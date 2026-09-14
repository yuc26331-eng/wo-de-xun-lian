import type { BodyMetric, DailyLog, ExerciseDef, Goal, TrainingPlan, WorkoutSummary } from '../types';
import { addDays, nowISO, toISODate, uid } from '../lib/format';

const today = toISODate();

function ex(
  name: string,
  order: number,
  target: TrainingPlan['exercises'][number]['target'],
  kind: TrainingPlan['exercises'][number]['kind'] = 'strength',
  cue?: string,
  notes?: string,
): TrainingPlan['exercises'][number] {
  return { id: uid('ex'), name, kind, target, order, cue, notes };
}

/** 示例训练数据：首次打开时写入，让所有功能马上可用可测 */
export function createSamplePlans(): TrainingPlan[] {
  const now = nowISO();
  return [
    {
      id: uid('plan'),
      title: '下肢力量 + 爆发力',
      date: today,
      kind: 'strength',
      source: 'sample',
      estimatedMinutes: 75,
      warmup: [
        { name: '动态拉伸', detail: '髋部、腘绳肌、踝关节各 30 秒', durationSec: 300 },
        { name: '慢跑热身', detail: '心率升到 120 左右', durationSec: 300 },
        { name: '空杆深蹲', detail: '2 组 × 10 次', durationSec: 180 },
      ],
      exercises: [
        ex('杠铃深蹲', 0, { sets: 4, reps: '5', weightKg: 90, restSec: 180, rpe: 8, tempo: '3-1-1' }, 'strength', '下蹲到大腿与地面平行，膝盖对准脚尖方向', '全程收紧核心，不要塌腰'),
        ex('罗马尼亚硬拉', 1, { sets: 3, reps: '8', weightKg: 70, restSec: 120, rpe: 7 }, 'strength', '髋关节后移，感受腘绳肌拉伸', '保持背部中立'),
        ex('保加利亚分腿蹲', 2, { sets: 3, reps: '10', weightKg: 20, restSec: 90, rpe: 8 }, 'strength', '前脚掌踩稳，躯干略前倾', '两侧各 10 次'),
        ex('箱式跳', 3, { sets: 4, reps: '5', restSec: 120, rpe: 7 }, 'strength', '落地要轻，屈髋缓冲', '组间充分休息，保证爆发质量'),
        ex('北欧式腘绳肌弯举', 4, { sets: 3, reps: '6', restSec: 90, rpe: 8 }, 'strength', '身体缓慢前倾，控制离心', '有腘绳肌伤史先降低幅度'),
        ex('平板支撑', 5, { sets: 3, durationSec: 60, restSec: 60, rpe: 6 }, 'strength', '臀部夹紧，肋骨下沉', '腰部不要塌陷'),
      ],
      cooldown: '静态拉伸：股四头肌、腘绳肌、臀肌各 30 秒 × 2 组；泡沫轴放松大腿前侧 2 分钟。',
      notes: '睡眠不足时把深蹲重量降到 80kg，RPE 控制在 7 以内。',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('plan'),
      title: '上肢推 + 核心',
      date: addDays(today, 1),
      kind: 'strength',
      source: 'sample',
      estimatedMinutes: 55,
      warmup: [
        { name: '肩袖激活', detail: '弹力带外旋 2 组 × 15 次', durationSec: 240 },
        { name: '俯卧撑热身', detail: '2 组 × 10 次', durationSec: 120 },
      ],
      exercises: [
        ex('杠铃卧推', 0, { sets: 4, reps: '6', weightKg: 65, restSec: 150, rpe: 8 }, 'strength', '肩胛骨后缩下沉，杠铃触胸', '手腕保持中立位'),
        ex('哑铃肩推', 1, { sets: 3, reps: '10', weightKg: 18, restSec: 90, rpe: 8 }, 'strength', '小臂垂直，推到头顶稍前', undefined),
        ex('绳索下压', 2, { sets: 3, reps: '12', weightKg: 25, restSec: 60, rpe: 7 }, 'strength', '肘部固定，只有小臂运动', undefined),
        ex('坐姿划船', 3, { sets: 3, reps: '10', weightKg: 45, restSec: 90, rpe: 7 }, 'strength', '肩胛骨先动，再带动手臂', undefined),
        ex('悬垂举腿', 4, { sets: 3, reps: '12', restSec: 60, rpe: 7 }, 'strength', '骨盆后倾卷起', '腰部不适时改为屈膝'),
      ],
      cooldown: '胸小肌、背阔肌拉伸各 30 秒 × 2 组。',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('plan'),
      title: '间歇跑 + 足球技术',
      date: addDays(today, 2),
      kind: 'run',
      source: 'sample',
      estimatedMinutes: 70,
      warmup: [
        { name: '慢跑', detail: '10 分钟轻松跑，心率 130 以内', durationSec: 600 },
        { name: '动态拉伸 + 加速跑', detail: '3 × 30 米加速跑', durationSec: 300 },
      ],
      exercises: [
        ex('400 米间歇跑', 0, { sets: 6, durationSec: 90, distanceKm: 0.4, paceText: '4:00/km', hrBpm: 175, restSec: 120 }, 'run', '保持稳定配速，最后 100 米不冲刺', '每组结束后走 2 分钟恢复'),
        ex('足球带球绕杆', 1, { sets: 6, durationSec: 60, restSec: 60, rpe: 6, playMin: 20 }, 'football', '低重心，触球频率快', '注意踝关节保护'),
        ex('慢跑放松', 2, { durationSec: 600, distanceKm: 1.5, hrBpm: 130 }, 'run', '心率降到 130 以下', undefined),
      ],
      cooldown: '小腿、髂胫束、股四头肌拉伸各 40 秒 × 2 组。',
      notes: '如遇雨天可在室内改为自行车 20 分钟 + 核心训练。',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

const LIB: [string, ExerciseDef['primaryMuscles'], ExerciseDef['kind'], string][] = [
  ['杠铃深蹲', ['股四头肌', '臀大肌'], 'strength', '下蹲到大腿平行地面，膝盖对准脚尖'],
  ['前蹲', ['股四头肌', '核心'], 'strength', '肘部抬高，躯干保持直立'],
  ['罗马尼亚硬拉', ['腘绳肌', '臀大肌'], 'strength', '髋部后移，背部中立'],
  ['传统硬拉', ['臀大肌', '竖脊肌'], 'strength', '杠铃贴腿，髋膝同时伸展'],
  ['保加利亚分腿蹲', ['股四头肌', '臀大肌'], 'strength', '前脚踩稳，身体略前倾'],
  ['腿举', ['股四头肌'], 'strength', '膝盖不要完全锁死'],
  ['腿弯举', ['腘绳肌'], 'strength', '控制离心，不要甩动'],
  ['腿屈伸', ['股四头肌'], 'strength', '顶端停顿一秒'],
  ['站姿提踵', ['小腿'], 'strength', '全幅度，顶端停顿'],
  ['臀桥', ['臀大肌'], 'strength', '顶端夹紧臀部两秒'],
  ['杠铃卧推', ['胸大肌', '肱三头肌'], 'strength', '肩胛骨后缩下沉'],
  ['上斜哑铃卧推', ['胸大肌上部'], 'strength', '哑铃成弧线推起'],
  ['哑铃肩推', ['三角肌前束'], 'strength', '小臂垂直于地面'],
  ['侧平举', ['三角肌中束'], 'strength', '肘部微屈，抬到肩高'],
  ['引体向上', ['背阔肌', '肱二头肌'], 'strength', '肩胛骨先下沉再拉'],
  ['高位下拉', ['背阔肌'], 'strength', '拉向锁骨，不要后仰过多'],
  ['坐姿划船', ['背阔肌', '菱形肌'], 'strength', '肩胛骨先动'],
  ['单臂哑铃划船', ['背阔肌'], 'strength', '肘部贴近身体'],
  ['面拉', ['三角肌后束'], 'strength', '拉向面部，肘部外展'],
  ['杠铃弯举', ['肱二头肌'], 'strength', '肘部固定不摆动'],
  ['绳索下压', ['肱三头肌'], 'strength', '肘部夹紧身体两侧'],
  ['仰卧臂屈伸', ['肱三头肌'], 'strength', '肘部朝前不外张'],
  ['平板支撑', ['核心'], 'strength', '臀部夹紧，肋骨下沉'],
  ['悬垂举腿', ['腹直肌'], 'strength', '骨盆后倾卷起'],
  ['俄罗斯转体', ['腹斜肌'], 'strength', '胸部带动旋转'],
  ['死虫式', ['核心'], 'strength', '腰部贴地，动作缓慢'],
  ['鸟狗式', ['核心', '竖脊肌'], 'strength', '保持骨盆稳定'],
  ['壶铃摆荡', ['臀大肌', '腘绳肌'], 'strength', '髋部爆发，手臂放松'],
  ['箱式跳', ['下肢爆发力'], 'strength', '轻柔落地，屈髋缓冲'],
  ['高翻', ['全身爆发力'], 'strength', '杠铃贴身，快速下蹲接杠'],
  ['轻松跑', ['心肺'], 'run', '能正常说话的强度'],
  ['间歇跑 400m', ['心肺', '速度'], 'run', '配速稳定，避免起步过快'],
  ['节奏跑', ['心肺'], 'run', '接近乳酸阈值的持续跑'],
  ['长距离慢跑', ['心肺', '耐力'], 'run', '控制心率在 140 以内'],
  ['冲刺跑 30m', ['速度'], 'run', '全力加速，充分休息'],
  ['折返跑', ['无氧耐力'], 'football', '急停急起，注意踝关节'],
  ['带球绕杆', ['控球技术'], 'football', '低重心，高频触球'],
  ['小场对抗', ['比赛体能'], 'football', '控制上场时间'],
  ['自行车有氧', ['心肺'], 'ride', '踏频保持在 80-90'],
  ['功率骑行间歇', ['心肺', '腿部力量'], 'ride', '间歇期保持踏频'],
  ['静态拉伸', ['柔韧性'], 'stretch', '拉到轻微牵拉感，保持呼吸'],
  ['泡沫轴放松', ['恢复'], 'recovery', '在紧张部位停留 30 秒'],
  ['动态热身', ['热身'], 'stretch', '逐步增加活动幅度'],
];

export function createSeedExercises(): ExerciseDef[] {
  return LIB.map(([name, muscles, kind, cue]) => ({
    id: uid('lib'),
    name,
    kind,
    primaryMuscles: muscles,
    cue,
    custom: false,
  }));
}

export function createSeedMetrics(): BodyMetric[] {
  const now = nowISO();
  const rows: BodyMetric[] = [];
  const weights = [72.8, 72.5, 72.4, 72.1, 71.9, 71.6, 71.4];
  weights.forEach((w, i) => {
    const date = addDays(today, -(6 - i));
    rows.push({
      id: date,
      date,
      weightKg: w,
      bodyFatPct: i % 2 === 0 ? 15.4 - i * 0.1 : null,
      sleepHours: 7.5 - (i % 3) * 0.4,
      sleepQuality: i % 2 === 0 ? 4 : 3,
      recovery: 3 + (i % 3),
      waterMl: 2000 + i * 100,
      proteinG: 130 + i * 5,
      createdAt: now,
      updatedAt: now,
    });
  });
  return rows;
}

export function createSeedDailyLog(): DailyLog[] {
  const now = nowISO();
  return [
    {
      id: addDays(today, -1),
      date: addDays(today, -1),
      weightKg: 71.6,
      trainingContent: '下肢力量：深蹲 4×5@87.5kg，罗马尼亚硬拉 3×8@67.5kg',
      trainingVolumeKg: 8420,
      rpe: 8,
      sleepHours: 7.2,
      diet: '早餐燕麦鸡蛋，午餐米饭鸡胸，晚餐牛肉意面',
      supplements: { proteinScoops: 2, proteinG: 50, creatineG: 5 },
      pain: '右膝轻微不适（深蹲最后两组）',
      feeling: '整体状态不错，力量有提升',
      fatigue: 6,
      source: 'sample',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createSeedGoals(): Goal[] {
  const now = nowISO();
  return [
    {
      id: uid('goal'),
      title: '体重降到 70kg',
      kind: 'weight',
      startValue: 72.8,
      targetValue: 70,
      unit: 'kg',
      deadline: addDays(today, 60),
      done: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('goal'),
      title: '每周训练 5 次',
      kind: 'frequency',
      targetValue: 5,
      unit: '次/周',
      done: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('goal'),
      title: '深蹲 1RM 达到 120kg',
      kind: 'strength',
      startValue: 100,
      targetValue: 120,
      unit: 'kg',
      done: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createSeedSummaries(plan: TrainingPlan): WorkoutSummary[] {
  const now = nowISO();
  const date = addDays(today, -1);
  return [
    {
      id: uid('sum'),
      sessionId: uid('sess'),
      planId: plan.id,
      planTitle: plan.title,
      kind: plan.kind,
      date,
      startedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      endedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      totalDurationSec: 3720,
      completedExercises: plan.exercises.slice(0, 5).map((e) => e.name),
      skippedExercises: plan.exercises.slice(5).map((e) => e.name),
      totalSets: 17,
      totalReps: 132,
      totalVolumeKg: 8420,
      completionRate: 0.83,
      cardio: [],
      bodyWeightKg: 71.6,
      rpe: 8,
      fatigue: 6,
      painSites: ['右膝'],
      feeling: '状态不错',
      note: '下次增加深蹲 2.5kg',
      createdAt: now,
    },
  ];
}
