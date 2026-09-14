import { describe, expect, it } from 'vitest';
import type { LiveSession, TrainingPlan } from '../types';
import {
  addSet,
  buildLiveSession,
  completeSet,
  completeSetAndRest,
  doneSetCount,
  elapsedSec,
  finishSession,
  goToNext,
  goToPrev,
  markExerciseDone,
  pauseSession,
  plannedSetCount,
  recordPain,
  removeSet,
  restRemainingSec,
  resumeSession,
  sessionProgress,
  sessionTotals,
  setOverride,
  skipExercise,
  startRest,
  undoSet,
  updateSetRecord,
} from './session';
import { uid } from './format';

function makePlan(): TrainingPlan {
  const now = new Date().toISOString();
  return {
    id: 'plan_test',
    title: '测试计划',
    date: '2026-09-15',
    kind: 'strength',
    source: 'sample',
    estimatedMinutes: 60,
    warmup: [{ name: '慢跑', durationSec: 300 }],
    exercises: [
      {
        id: 'ex_squat',
        name: '杠铃深蹲',
        kind: 'strength',
        target: { sets: 3, reps: '5', weightKg: 90, restSec: 120, rpe: 8 },
        cue: '膝盖对准脚尖',
        order: 0,
      },
      {
        id: 'ex_plank',
        name: '平板支撑',
        kind: 'strength',
        target: { sets: 2, durationSec: 60, restSec: 60 },
        order: 1,
      },
      {
        id: 'ex_run',
        name: '400 米间歇跑',
        kind: 'run',
        target: { sets: 4, durationSec: 90, distanceKm: 0.4, hrBpm: 175, restSec: 120 },
        order: 2,
      },
    ],
    cooldown: '拉伸 10 分钟',
    createdAt: now,
    updatedAt: now,
  };
}

/** 固定时间的会话，方便断言 elapsedSec */
function sessionAt(offsetSec: number, extra: Partial<LiveSession> = {}): LiveSession {
  const base = buildLiveSession(makePlan());
  const resumedAt = new Date(Date.now() - offsetSec * 1000).toISOString();
  return { ...base, lastResumedAt: resumedAt, accumulatedSec: 0, ...extra };
}

describe('buildLiveSession', () => {
  it('按计划生成动作与目标组数，并从第一项开始', () => {
    const s = buildLiveSession(makePlan());
    expect(s.status).toBe('active');
    expect(s.currentIndex).toBe(0);
    expect(s.exercises).toHaveLength(3);
    expect(s.exercises[0].sets).toHaveLength(3);
    expect(s.exercises[1].sets).toHaveLength(2);
    expect(s.exercises[0].sets[0].weightKg).toBe(90);
    expect(s.exercises[0].sets[0].reps).toBe(5);
    expect(s.logs[0].type).toBe('start');
    expect(s.restUntil).toBeNull();
  });

  it('次数区间取第一个数字，AMRAP 取 null', () => {
    const plan = makePlan();
    plan.exercises[0].target.reps = '8-12';
    plan.exercises[1].target.reps = 'AMRAP';
    const s = buildLiveSession(plan);
    expect(s.exercises[0].sets[0].reps).toBe(8);
    expect(s.exercises[1].sets[0].reps).toBeNull();
  });

  it('没有动作的计划也不会崩溃', () => {
    const plan = makePlan();
    plan.exercises = [];
    const s = buildLiveSession(plan);
    expect(s.exercises).toHaveLength(1);
    expect(s.exercises[0].name).toBe('测试计划');
  });
});

describe('计时（锁屏后仍然正确）', () => {
  it('按绝对时间计算已训练时长', () => {
    const s = sessionAt(125);
    expect(elapsedSec(s)).toBeGreaterThanOrEqual(124);
    expect(elapsedSec(s)).toBeLessThanOrEqual(126);
  });

  it('暂停后时间冻结，恢复后继续累加', () => {
    const s = sessionAt(100);
    const paused = pauseSession(s).session;
    expect(paused.status).toBe('paused');
    expect(paused.lastResumedAt).toBeNull();
    expect(paused.accumulatedSec).toBeGreaterThanOrEqual(99);
    // 暂停期间过了一段时间，时长不变
    expect(elapsedSec(paused)).toBe(paused.accumulatedSec);

    const frozen = elapsedSec(paused, Date.now() + 60_000);
    expect(frozen).toBe(paused.accumulatedSec);

    const resumed = resumeSession(paused).session;
    expect(resumed.status).toBe('active');
    const later = elapsedSec(resumed, Date.now() + 30_000);
    expect(later).toBeGreaterThanOrEqual(paused.accumulatedSec + 29);
  });

  it('重复暂停/恢复会被拒绝', () => {
    const s = sessionAt(10);
    expect(pauseSession(s).changed).toBe(true);
    expect(pauseSession(pauseSession(s).session).changed).toBe(false);
    expect(resumeSession(s).changed).toBe(false);
  });
});

describe('完成本组（防重复记录）', () => {
  it('第一次完成写入记录，第二次拒绝', () => {
    const s = buildLiveSession(makePlan());
    const setId = s.exercises[0].sets[0].id;
    const first = completeSet(s, setId, { weightKg: 92.5, reps: 5 });
    expect(first.changed).toBe(true);
    expect(first.session.exercises[0].sets[0].done).toBe(true);
    expect(first.session.exercises[0].sets[0].weightKg).toBe(92.5);
    expect(doneSetCount(first.session.exercises[0])).toBe(1);
    expect(first.session.logs.filter((l) => l.type === 'set-complete')).toHaveLength(1);

    const second = completeSet(first.session, setId, { weightKg: 92.5 });
    expect(second.changed).toBe(false);
    expect(second.reason).toContain('已经记录过');
    expect(second.session.exercises[0].sets.filter((x) => x.done)).toHaveLength(1);
  });

  it('完成一组后自动开始休息，且休息结束时间是绝对值', () => {
    const s = buildLiveSession(makePlan());
    const setId = s.exercises[0].sets[0].id;
    const now = Date.now();
    const next = completeSetAndRest(s, setId, undefined, 90).session;
    expect(next.restUntil).not.toBeNull();
    expect(next.restTotalSec).toBe(120); // 目标里的 120 秒优先
    expect(Date.parse(next.restUntil!)).toBeGreaterThan(now);
    expect(restRemainingSec(next, now)).toBeGreaterThan(118);
    // 休息结束后剩余时间为 0
    expect(restRemainingSec(next, now + 130_000)).toBe(0);
  });

  it('最后一组完成后不再启动休息', () => {
    let s = buildLiveSession(makePlan());
    for (const set of s.exercises[0].sets) {
      s = completeSetAndRest(s, set.id, undefined, 90).session;
    }
    expect(s.restUntil).toBeNull();
    expect(doneSetCount(s.exercises[0])).toBe(3);
  });

  it('可以撤销误点的一组', () => {
    const s = buildLiveSession(makePlan());
    const setId = s.exercises[0].sets[0].id;
    const done = completeSet(s, setId).session;
    const undone = undoSet(done, setId);
    expect(undone.changed).toBe(true);
    expect(undone.session.exercises[0].sets[0].done).toBe(false);
    expect(undoSet(undone.session, setId).changed).toBe(false);
  });

  it('可以修改实际重量与次数', () => {
    const s = buildLiveSession(makePlan());
    const setId = s.exercises[0].sets[0].id;
    const changed = updateSetRecord(s, setId, { weightKg: 100, reps: 3 });
    expect(changed.session.exercises[0].sets[0].weightKg).toBe(100);
    expect(changed.session.exercises[0].sets[0].reps).toBe(3);
  });
});

describe('组数调整与临时修改', () => {
  it('增加/减少一组', () => {
    const s = buildLiveSession(makePlan());
    const id = s.exercises[0].exerciseId;
    const added = addSet(s, id).session;
    expect(added.exercises[0].sets).toHaveLength(4);
    expect(plannedSetCount(added.exercises[0])).toBe(4);
    const removed = removeSet(added, id).session;
    expect(removed.exercises[0].sets).toHaveLength(3);
  });

  it('已完成的最后一组不能被删除', () => {
    let s = buildLiveSession(makePlan());
    const id = s.exercises[0].exerciseId;
    s = addSet(s, id).session;
    s = completeSet(s, s.exercises[0].sets[3].id).session;
    const res = removeSet(s, id);
    expect(res.changed).toBe(false);
    expect(res.session.exercises[0].sets).toHaveLength(4);
  });

  it('临时调整重量/次数/休息只影响未完成的组', () => {
    let s = buildLiveSession(makePlan());
    const id = s.exercises[0].exerciseId;
    s = completeSet(s, s.exercises[0].sets[0].id, { weightKg: 90 }).session;
    s = setOverride(s, id, { weightKg: 80, reps: '8', restSec: 45 }).session;
    expect(s.exercises[0].sets[0].weightKg).toBe(90);
    expect(s.exercises[0].sets[1].weightKg).toBe(80);
    expect(s.exercises[0].sets[1].reps).toBe(8);
    expect(s.exercises[0].override?.restSec).toBe(45);
  });
});

describe('动作切换', () => {
  it('完成动作后自动进入下一个未完成动作', () => {
    const s = buildLiveSession(makePlan());
    const next = markExerciseDone(s, s.exercises[0].exerciseId).session;
    expect(next.exercises[0].status).toBe('done');
    expect(next.currentIndex).toBe(1);
  });

  it('跳过动作后进入下一项，并可手动前后切换', () => {
    const s = buildLiveSession(makePlan());
    const skipped = skipExercise(s, s.exercises[1].exerciseId).session;
    expect(skipped.exercises[1].status).toBe('skipped');
    const prev = goToPrev(skipped).session;
    expect(prev.currentIndex).toBe(0);
    expect(goToPrev(prev).changed).toBe(false);
    const next = goToNext(skipped).session;
    expect(next.currentIndex).toBe(2);
    expect(goToNext(next).changed).toBe(false);
  });
});

describe('疼痛记录与休息控制', () => {
  it('记录疼痛并按 1~10 收敛', () => {
    const s = buildLiveSession(makePlan());
    const res = recordPain(s, { site: '右膝', level: 22, note: '深蹲时' });
    expect(res.session.pain).toHaveLength(1);
    expect(res.session.pain[0].level).toBe(10);
    expect(res.session.pain[0].site).toBe('右膝');
  });

  it('手动开始休息时使用绝对时间', () => {
    const s = buildLiveSession(makePlan());
    const now = 1_700_000_000_000;
    const res = startRest(s, 60, undefined, now);
    expect(res.session.restUntil).toBe(new Date(now + 60_000).toISOString());
    expect(restRemainingSec(res.session, now + 30_000)).toBe(30);
  });
});

describe('训练统计与总结', () => {
  it('统计组数、次数、容量与完成率', () => {
    let s = buildLiveSession(makePlan());
    const squat = s.exercises[0];
    s = completeSet(s, squat.sets[0].id, { weightKg: 100, reps: 5 }).session;
    s = completeSet(s, s.exercises[0].sets[1].id, { weightKg: 100, reps: 5 }).session;
    const totals = sessionTotals(s);
    expect(totals.totalSets).toBe(2);
    expect(totals.totalReps).toBe(10);
    expect(totals.totalVolumeKg).toBe(1000);
    expect(totals.plannedSets).toBe(9);
    expect(totals.completionRate).toBeCloseTo(2 / 9, 3);
  });

  it('生成今日总结：完成/跳过动作、cardio、疼痛、时长', () => {
    let s = buildLiveSession(makePlan());
    // 完成深蹲全部 3 组
    for (const set of s.exercises[0].sets) {
      s = completeSet(s, set.id, { weightKg: 90, reps: 5 }).session;
    }
    // 跳过平板支撑
    s = skipExercise(s, s.exercises[1].exerciseId).session;
    // 跑步完成 1 组 90 秒 0.4km
    const run = s.exercises[2];
    s = completeSet(s, run.sets[0].id, { durationSec: 90, distanceKm: 0.4, hrBpm: 170 }).session;
    s = recordPain(s, { site: '右膝', level: 3 }).session;
    const now = new Date();

    const summary = finishSession(
      s,
      { bodyWeightKg: 71.2, rpe: 8, fatigue: 6, feeling: '状态不错', note: '下次加 2.5kg' },
      now,
    );

    expect(summary.completedExercises).toContain('杠铃深蹲');
    // 跑步只完成了 1/4 组，因此不算「完成动作」，但实际跑量会进 cardio 记录
    expect(summary.completedExercises).not.toContain('400 米间歇跑');
    expect(summary.skippedExercises).toContain('平板支撑');
    expect(summary.totalSets).toBe(4);
    expect(summary.totalReps).toBe(15);
    expect(summary.totalVolumeKg).toBe(1350);
    expect(summary.date).toBe(
      `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`,
    );
    expect(summary.bodyWeightKg).toBe(71.2);
    expect(summary.painSites).toEqual(['右膝']);
    expect(summary.cardio).toHaveLength(1);
    expect(summary.cardio[0].distanceKm).toBe(0.4);
    expect(summary.cardio[0].avgHr).toBe(170);
    expect(summary.totalDurationSec).toBeGreaterThanOrEqual(0);
    expect(summary.id).toMatch(/^sum_/);
  });

  it('进度信息用于顶部显示', () => {
    const s = buildLiveSession(makePlan());
    const p = sessionProgress(s);
    expect(p.total).toBe(3);
    expect(p.index).toBe(0);
    expect(p.plannedSets).toBe(9);
    expect(p.doneSets).toBe(0);
  });

  it('uid 生成稳定前缀', () => {
    expect(uid('set')).toMatch(/^set_/);
  });
});
