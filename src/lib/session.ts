/**
 * 实时跟练状态机（纯函数，不依赖 React / DOM）
 *
 * 设计原则：
 * 1. 所有写操作返回 { session, changed, reason? }，便于 UI 做防重复点击提示；
 * 2. 计时全部基于绝对时间戳（startedAt / lastResumedAt / accumulatedSec / restUntil），
 *    因此锁屏、切后台、关闭页面后回来，时间与进度依然正确；
 * 3. 每次调用都返回新的对象（不可变更新），便于直接写入 IndexedDB。
 */
import { formatPace, kindIsCardio, nowISO, toISODate, uid } from './format';
import type {
  CardioRecord,
  ExerciseItem,
  ExerciseProgress,
  ExerciseSetRecord,
  ISODate,
  LiveSession,
  PainRecord,
  SessionKind,
  SessionLogEntry,
  SetRecord,
  TargetSpec,
  TrainingPlan,
  WorkoutSummary,
} from '../types';

export interface SessionResult {
  session: LiveSession;
  changed: boolean;
  reason?: string;
}

export interface FinishExtras {
  bodyWeightKg?: number | null;
  rpe?: number | null;
  fatigue?: number | null;
  painSites?: string[];
  feeling?: string;
  note?: string;
}

const ok = (session: LiveSession): SessionResult => ({ session, changed: true });
const no = (session: LiveSession, reason: string): SessionResult => ({
  session,
  changed: false,
  reason,
});

function touch(session: LiveSession, logs: SessionLogEntry[]): LiveSession {
  return { ...session, logs, updatedAt: nowISO() };
}

function logEntry(
  type: SessionLogEntry['type'],
  extra: Partial<SessionLogEntry> = {},
): SessionLogEntry {
  return { id: uid('log'), at: nowISO(), type, ...extra };
}

/** 取 8-12 / 10次 / AMRAP 中的数字，取不到返回 null */
export function repsToNumber(reps: string | null | undefined): number | null {
  if (!reps) return null;
  const m = reps.match(/\d{1,3}/);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) && n > 0 ? n : null;
}

/** 目标组数（含临时增减） */
export function plannedSetCount(ex: ExerciseProgress, fallback = 3): number {
  const base = Math.max(1, Math.round(ex.target.sets ?? fallback));
  return Math.max(1, base + (ex.extraSets ?? 0));
}

/** 合并临时调整后的目标 */
export function effectiveTarget(ex: ExerciseProgress): TargetSpec {
  const o = ex.override;
  if (!o) return ex.target;
  return {
    ...ex.target,
    ...(o.weightKg !== undefined ? { weightKg: o.weightKg } : {}),
    ...(o.reps !== undefined ? { reps: o.reps } : {}),
    ...(o.restSec !== undefined ? { restSec: o.restSec } : {}),
  };
}

/** 该动作的组间休息（秒） */
export function restSecondsFor(ex: ExerciseProgress, fallback = 90): number {
  const sec = effectiveTarget(ex).restSec;
  if (sec == null || !isFinite(sec) || sec <= 0) return fallback;
  return Math.round(sec);
}

function newSet(index: number, target: TargetSpec): SetRecord {
  return {
    id: uid('set'),
    index,
    weightKg: target.weightKg ?? null,
    reps: target.durationSec != null ? null : repsToNumber(target.reps),
    durationSec: target.durationSec ?? null,
    distanceKm: null,
    hrBpm: null,
    rpe: null,
    done: false,
    completedAt: null,
  };
}

function exerciseFromItem(item: ExerciseItem, order: number): ExerciseProgress {
  const baseSets = Math.max(1, Math.round(item.target.sets ?? (kindIsCardio(item.kind) ? 1 : 3)));
  return {
    exerciseId: item.id,
    name: item.name || `动作 ${order + 1}`,
    kind: item.kind,
    target: item.target,
    cue: item.cue,
    notes: item.notes,
    sets: Array.from({ length: baseSets }, (_, i) => newSet(i + 1, item.target)),
    status: 'pending',
    extraSets: 0,
  };
}

/** 用计划创建一个可跟练的会话 */
export function buildLiveSession(
  plan: TrainingPlan,
  options: { defaultRestSec?: number } = {},
): LiveSession {
  const startedAt = nowISO();
  const exercises = plan.exercises
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item, i) => exerciseFromItem(item, i));

  if (!exercises.length) {
    exercises.push(
      exerciseFromItem(
        {
          id: uid('ex'),
          name: plan.title || '自由训练',
          kind: plan.kind,
          target: { sets: 1 },
          order: 0,
        },
        0,
      ),
    );
  }

  return {
    id: uid('sess'),
    planId: plan.id,
    planTitle: plan.title,
    kind: plan.kind,
    startedAt,
    endedAt: null,
    accumulatedSec: 0,
    lastResumedAt: startedAt,
    status: 'active',
    currentIndex: 0,
    exercises,
    restUntil: null,
    restTotalSec: options.defaultRestSec ?? 90,
    restAfterExerciseId: null,
    logs: [logEntry('start', { detail: plan.title })],
    pain: [],
    updatedAt: startedAt,
  };
}

/** 已训练时长（秒），暂停期间不计时 */
export function elapsedSec(session: LiveSession, nowMs: number = Date.now()): number {
  const base = Math.max(0, session.accumulatedSec ?? 0);
  if (session.status === 'paused' || !session.lastResumedAt) return Math.round(base);
  const since = (nowMs - Date.parse(session.lastResumedAt)) / 1000;
  return Math.round(base + Math.max(0, since));
}

/** 剩余休息秒数（0 表示已结束或没有休息） */
export function restRemainingSec(session: LiveSession, nowMs: number = Date.now()): number {
  if (!session.restUntil) return 0;
  const left = (Date.parse(session.restUntil) - nowMs) / 1000;
  return left > 0 ? Math.ceil(left) : 0;
}

export function isResting(session: LiveSession, nowMs: number = Date.now()): boolean {
  return restRemainingSec(session, nowMs) > 0;
}

export function currentExercise(session: LiveSession): ExerciseProgress | null {
  return session.exercises[session.currentIndex] ?? session.exercises[0] ?? null;
}

/** 所有组都已完成（或状态已标记完成） */
export function isExerciseComplete(ex: ExerciseProgress): boolean {
  if (ex.status === 'done') return true;
  if (ex.status === 'skipped') return false;
  return ex.sets.length > 0 && ex.sets.every((s) => s.done);
}

export function isExerciseSkipped(ex: ExerciseProgress): boolean {
  return ex.status === 'skipped';
}

/** 第一个未完成的组（全部完成返回 null） */
export function nextPendingSet(ex: ExerciseProgress): SetRecord | null {
  return ex.sets.find((s) => !s.done) ?? null;
}

export function doneSetCount(ex: ExerciseProgress): number {
  return ex.sets.filter((s) => s.done).length;
}

export interface SessionProgress {
  index: number;
  total: number;
  doneSets: number;
  plannedSets: number;
  rate: number;
}

export function sessionProgress(session: LiveSession): SessionProgress {
  const plannedSets = session.exercises.reduce(
    (n, ex) => n + Math.max(ex.sets.length, plannedSetCount(ex)),
    0,
  );
  const doneSets = session.exercises.reduce((n, ex) => n + doneSetCount(ex), 0);
  const total = session.exercises.length;
  const index = Math.min(Math.max(0, session.currentIndex), Math.max(0, total - 1));
  return {
    index,
    total,
    doneSets,
    plannedSets,
    rate: plannedSets > 0 ? Math.min(1, doneSets / plannedSets) : 0,
  };
}

function mapExercise(
  session: LiveSession,
  exerciseId: string,
  fn: (ex: ExerciseProgress) => ExerciseProgress,
): { session: LiveSession; found: boolean } {
  let found = false;
  const exercises = session.exercises.map((ex) => {
    if (ex.exerciseId !== exerciseId) return ex;
    found = true;
    return fn(ex);
  });
  return { session: { ...session, exercises }, found };
}

function mapSet(
  session: LiveSession,
  setId: string,
  fn: (set: SetRecord, ex: ExerciseProgress) => SetRecord,
): { session: LiveSession; exerciseId: string | null } {
  let exerciseId: string | null = null;
  const exercises = session.exercises.map((ex) => {
    if (!ex.sets.some((s) => s.id === setId)) return ex;
    exerciseId = ex.exerciseId;
    return {
      ...ex,
      sets: ex.sets.map((s) => (s.id === setId ? fn(s, ex) : s)),
    };
  });
  return { session: { ...session, exercises }, exerciseId };
}

/** 把会话当前动作推进到下一个未完成且未跳过的动作 */
function advance(session: LiveSession, fromIndex: number): number {
  const total = session.exercises.length;
  for (let step = 1; step <= total; step += 1) {
    const i = (fromIndex + step) % total;
    const ex = session.exercises[i];
    if (ex && ex.status !== 'done' && ex.status !== 'skipped') return i;
  }
  return Math.min(fromIndex, Math.max(0, total - 1));
}

export interface SetPatch {
  weightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
  distanceKm?: number | null;
  hrBpm?: number | null;
  rpe?: number | null;
}

function applySetPatch(set: SetRecord, patch?: SetPatch): SetRecord {
  if (!patch) return set;
  return {
    ...set,
    ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
    ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
    ...(patch.durationSec !== undefined ? { durationSec: patch.durationSec } : {}),
    ...(patch.distanceKm !== undefined ? { distanceKm: patch.distanceKm } : {}),
    ...(patch.hrBpm !== undefined ? { hrBpm: patch.hrBpm } : {}),
    ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
  };
}

/**
 * 完成一组。幂等：同一组重复提交（连点两次 / 重复渲染）只会记录一次。
 */
export function completeSet(session: LiveSession, setId: string, patch?: SetPatch): SessionResult {
  if (session.status === 'finished' || session.status === 'abandoned') {
    return no(session, '训练已结束');
  }
  const owner = session.exercises.find((ex) => ex.sets.some((s) => s.id === setId));
  const existing = owner?.sets.find((s) => s.id === setId);
  if (!owner || !existing) return no(session, '找不到这一组');
  if (existing.done) return no(session, '这一组已经记录过了');

  const { session: next, exerciseId } = mapSet(session, setId, (set) => ({
    ...applySetPatch(set, patch),
    done: true,
    completedAt: nowISO(),
  }));

  const withStatus: LiveSession = {
    ...next,
    exercises: next.exercises.map((ex) =>
      ex.exerciseId === exerciseId && ex.status === 'pending'
        ? { ...ex, status: 'active' as const }
        : ex,
    ),
  };
  return ok(
    touch(withStatus, [
      ...withStatus.logs,
      logEntry('set-complete', { exerciseId: exerciseId ?? undefined, setId }),
    ]),
  );
}

/** 撤销某一组（误点恢复） */
export function undoSet(session: LiveSession, setId: string): SessionResult {
  const owner = session.exercises.find((ex) => ex.sets.some((s) => s.id === setId));
  const set = owner?.sets.find((s) => s.id === setId);
  if (!owner || !set) return no(session, '找不到这一组');
  if (!set.done) return no(session, '这一组还没完成');
  const { session: next, exerciseId } = mapSet(session, setId, (s) => ({
    ...s,
    done: false,
    completedAt: null,
  }));
  return ok(
    touch(next, [
      ...next.logs,
      logEntry('set-undo', { exerciseId: exerciseId ?? undefined, setId }),
    ]),
  );
}

/** 修改某一组的实际数据（重量 / 次数 / 时长 / 距离 / 心率 / RPE） */
export function updateSetRecord(
  session: LiveSession,
  setId: string,
  patch: SetPatch,
): SessionResult {
  const exists = session.exercises.some((ex) => ex.sets.some((s) => s.id === setId));
  if (!exists) return no(session, '找不到这一组');
  const { session: next } = mapSet(session, setId, (set) => applySetPatch(set, patch));
  return ok({ ...next, updatedAt: nowISO() });
}

/** 临时调整该动作的目标（重量 / 次数 / 休息） */
export function setOverride(
  session: LiveSession,
  exerciseId: string,
  patch: { weightKg?: number | null; reps?: string | null; restSec?: number | null },
): SessionResult {
  const { session: next, found } = mapExercise(session, exerciseId, (ex) => {
    const override = { ...ex.override, ...patch };
    const target = effectiveTarget({ ...ex, override });
    // 未完成的组同步使用新目标，已完成的组保留真实记录
    const sets = ex.sets.map((s) =>
      s.done
        ? s
        : {
            ...s,
            weightKg: target.weightKg ?? s.weightKg,
            reps: repsToNumber(target.reps) ?? s.reps,
          },
    );
    return { ...ex, override, sets };
  });
  if (!found) return no(session, '找不到这个动作');
  return ok(
    touch(next, [
      ...next.logs,
      logEntry('note', { exerciseId, detail: `临时调整：${JSON.stringify(patch)}` }),
    ]),
  );
}

/** 增加一组（超出计划组数也允许） */
export function addSet(session: LiveSession, exerciseId: string): SessionResult {
  const { session: next, found } = mapExercise(session, exerciseId, (ex) => {
    const target = effectiveTarget(ex);
    const added: SetRecord = newSet(ex.sets.length + 1, target);
    return { ...ex, extraSets: (ex.extraSets ?? 0) + 1, sets: [...ex.sets, added] };
  });
  if (!found) return no(session, '找不到这个动作');
  return ok(touch(next, [...next.logs, logEntry('sets-add', { exerciseId })]));
}

/** 减少一组：不能少于 1 组，且不会删除已完成的组 */
export function removeSet(session: LiveSession, exerciseId: string): SessionResult {
  const ex = session.exercises.find((e) => e.exerciseId === exerciseId);
  if (!ex) return no(session, '找不到这个动作');
  if (ex.sets.length <= 1) return no(session, '至少要保留 1 组');
  const last = ex.sets[ex.sets.length - 1];
  if (last?.done) return no(session, '最后一组已完成，不能删除');
  const { session: next } = mapExercise(session, exerciseId, (item) => ({
    ...item,
    extraSets: (item.extraSets ?? 0) - 1,
    sets: item.sets.slice(0, -1),
  }));
  return ok(touch(next, [...next.logs, logEntry('sets-remove', { exerciseId })]));
}

/** 完成当前动作并跳到下一个未完成动作 */
export function markExerciseDone(session: LiveSession, exerciseId: string): SessionResult {
  const index = session.exercises.findIndex((ex) => ex.exerciseId === exerciseId);
  if (index < 0) return no(session, '找不到这个动作');
  const ex = session.exercises[index];
  if (ex.status === 'done') return no(session, '这个动作已经完成了');

  const exercises = session.exercises.map((item, i) =>
    i === index ? { ...item, status: 'done' as const } : item,
  );
  const partial: LiveSession = { ...session, exercises, restUntil: null, restAfterExerciseId: null };
  const next: LiveSession = { ...partial, currentIndex: advance(partial, index) };
  return ok(
    touch(next, [...next.logs, logEntry('exercise-done', { exerciseId, detail: ex.name })]),
  );
}

/** 跳过动作 */
export function skipExercise(session: LiveSession, exerciseId: string): SessionResult {
  const index = session.exercises.findIndex((ex) => ex.exerciseId === exerciseId);
  if (index < 0) return no(session, '找不到这个动作');
  const ex = session.exercises[index];
  if (ex.status === 'skipped') return no(session, '这个动作已经跳过了');

  const exercises = session.exercises.map((item, i) =>
    i === index ? { ...item, status: 'skipped' as const } : item,
  );
  const partial: LiveSession = { ...session, exercises, restUntil: null, restAfterExerciseId: null };
  const next: LiveSession = { ...partial, currentIndex: advance(partial, index) };
  return ok(
    touch(next, [...next.logs, logEntry('exercise-skip', { exerciseId, detail: ex.name })]),
  );
}

/** 跳到指定动作 */
export function goTo(session: LiveSession, index: number): SessionResult {
  const total = session.exercises.length;
  if (!total) return no(session, '没有可训练的动作');
  const target = Math.min(Math.max(0, index), total - 1);
  if (target === session.currentIndex) return no(session, '已经是这个动作了');
  const next: LiveSession = { ...session, currentIndex: target, restUntil: null, restAfterExerciseId: null };
  return ok(touch(next, next.logs));
}

export function goToNext(session: LiveSession): SessionResult {
  const total = session.exercises.length;
  for (let i = session.currentIndex + 1; i < total; i += 1) {
    const ex = session.exercises[i];
    if (ex && ex.status !== 'done' && ex.status !== 'skipped') return goTo(session, i);
  }
  // 没有待完成动作时，仍允许往后翻看（例如回看已完成的动作）
  if (session.currentIndex + 1 < total) return goTo(session, session.currentIndex + 1);
  return no(session, '已经是最后一项了');
}

/** 上一项：跳过已跳过的动作，但允许回看已完成的动作 */
export function goToPrev(session: LiveSession): SessionResult {
  for (let i = session.currentIndex - 1; i >= 0; i -= 1) {
    const ex = session.exercises[i];
    if (ex && ex.status !== 'skipped') return goTo(session, i);
  }
  if (session.currentIndex - 1 >= 0) return goTo(session, session.currentIndex - 1);
  return no(session, '已经是第一项了');
}

/** 暂停训练：把已用时间结算进 accumulatedSec */
export function pauseSession(session: LiveSession, nowMs: number = Date.now()): SessionResult {
  if (session.status !== 'active') return no(session, '当前不在训练中');
  const next: LiveSession = {
    ...session,
    status: 'paused',
    accumulatedSec: elapsedSec(session, nowMs),
    lastResumedAt: null,
    restUntil: null,
    restAfterExerciseId: null,
  };
  return ok(touch(next, [...next.logs, logEntry('pause')]));
}

/** 恢复训练 */
export function resumeSession(session: LiveSession): SessionResult {
  if (session.status !== 'paused') return no(session, '当前没有暂停');
  const next: LiveSession = { ...session, status: 'active', lastResumedAt: nowISO() };
  return ok(touch(next, [...next.logs, logEntry('resume')]));
}

/** 记录疼痛或不适 */
export function recordPain(
  session: LiveSession,
  pain: { site: string; level: number; note?: string; exerciseId?: string },
): SessionResult {
  if (!pain.site) return no(session, '请选择疼痛部位');
  const entry: PainRecord = {
    id: uid('pain'),
    at: nowISO(),
    site: pain.site,
    level: Math.min(10, Math.max(1, Math.round(pain.level))),
    note: pain.note,
    exerciseId: pain.exerciseId,
  };
  const next: LiveSession = { ...session, pain: [...session.pain, entry] };
  return ok(
    touch(next, [
      ...next.logs,
      logEntry('pain', { exerciseId: pain.exerciseId, detail: `${pain.site} ${entry.level}/10` }),
    ]),
  );
}

/** 开始组间休息（写入绝对结束时间，锁屏后依然准确） */
export function startRest(
  session: LiveSession,
  seconds: number,
  afterExerciseId?: string,
  nowMs: number = Date.now(),
): SessionResult {
  const sec = Math.max(5, Math.round(seconds));
  const next: LiveSession = {
    ...session,
    restUntil: new Date(nowMs + sec * 1000).toISOString(),
    restTotalSec: sec,
    restAfterExerciseId: afterExerciseId ?? currentExercise(session)?.exerciseId ?? null,
  };
  return ok({ ...next, updatedAt: nowISO() });
}

export function clearRest(session: LiveSession): SessionResult {
  if (!session.restUntil) return no(session, '没有进行中的休息');
  const next: LiveSession = { ...session, restUntil: null, restAfterExerciseId: null };
  return ok({ ...next, updatedAt: nowISO() });
}

/**
 * 完成一组并在还有剩余组时自动开始休息。
 * 页面只调用这一个函数，避免「完成组」与「开始休息」两次写入造成不一致。
 */
export function completeSetAndRest(
  session: LiveSession,
  setId: string,
  patch: SetPatch | undefined,
  defaultRestSec: number,
): SessionResult {
  const done = completeSet(session, setId, patch);
  if (!done.changed) return done;
  const ex = done.session.exercises.find((item) => item.sets.some((s) => s.id === setId));
  if (!ex) return done;
  const pending = ex.sets.some((s) => !s.done);
  if (!pending) {
    return { session: { ...done.session, restUntil: null, restAfterExerciseId: null }, changed: true };
  }
  const rest = startRest(done.session, restSecondsFor(ex, defaultRestSec), ex.exerciseId);
  return { session: rest.session, changed: true };
}

/** 记录一条训练中的备注 */
export function addSessionNote(
  session: LiveSession,
  note: string,
  exerciseId?: string,
): SessionResult {
  const trimmed = note.trim();
  if (!trimmed) return no(session, '备注为空');
  const next: LiveSession = { ...session, note: trimmed };
  return ok(touch(next, [...next.logs, logEntry('note', { detail: trimmed, exerciseId })]));
}

/** 汇总一个动作的实际完成情况，用于生成 cardio 记录 */
function cardioRecordFor(ex: ExerciseProgress): CardioRecord | null {
  const target = effectiveTarget(ex);
  const done = ex.sets.filter((s) => s.done);
  const cardioLike =
    kindIsCardio(ex.kind) ||
    target.durationSec != null ||
    target.distanceKm != null ||
    target.paceText != null ||
    target.hrBpm != null ||
    target.playMin != null;
  if (!cardioLike || !done.length) return null;

  const sumDuration = done.reduce((n, s) => n + (s.durationSec ?? 0), 0);
  const durationSec =
    sumDuration > 0
      ? sumDuration
      : target.durationSec != null
        ? target.durationSec * done.length
        : null;
  const sumDistance = done.reduce((n, s) => n + (s.distanceKm ?? 0), 0);
  const distanceKm = sumDistance > 0 ? Math.round(sumDistance * 100) / 100 : null;
  const hrList = done.map((s) => s.hrBpm).filter((v): v is number => v != null && v > 0);
  const avgHr = hrList.length
    ? Math.round(hrList.reduce((a, b) => a + b, 0) / hrList.length)
    : (target.hrBpm ?? null);
  const playMin =
    target.playMin != null
      ? Math.round(target.playMin * done.length)
      : ex.kind === 'football' && durationSec != null
        ? Math.round(durationSec / 60)
        : null;
  const speedKph =
    target.speedKph ??
    (distanceKm && durationSec
      ? Math.round((distanceKm / (durationSec / 3600)) * 10) / 10
      : null);
  const pace = formatPace(distanceKm, durationSec);

  return {
    kind: ex.kind,
    exerciseName: ex.name,
    durationSec,
    distanceKm,
    paceText: pace === '—' ? null : pace,
    speedKph,
    avgHr,
    playMin,
  };
}

export interface SessionTotals {
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  plannedSets: number;
  completionRate: number;
}

export function sessionTotals(session: LiveSession): SessionTotals {
  let totalSets = 0;
  let totalReps = 0;
  let totalVolumeKg = 0;
  let plannedSets = 0;
  for (const ex of session.exercises) {
    plannedSets += Math.max(ex.sets.length, plannedSetCount(ex));
    for (const s of ex.sets) {
      if (!s.done) continue;
      totalSets += 1;
      if (s.reps != null && s.reps > 0) {
        totalReps += s.reps;
        if (s.weightKg != null && s.weightKg > 0) {
          totalVolumeKg += s.weightKg * s.reps;
        }
      }
    }
  }
  const rate = plannedSets > 0 ? Math.min(1, totalSets / plannedSets) : 0;
  return {
    totalSets,
    totalReps,
    totalVolumeKg: Math.round(totalVolumeKg * 10) / 10,
    plannedSets,
    completionRate: rate,
  };
}

/** 结束训练，生成今日总结数据（写入历史由页面调用 saveSummary） */
export function finishSession(
  session: LiveSession,
  extras: FinishExtras = {},
  now: Date = new Date(),
): WorkoutSummary {
  const totals = sessionTotals(session);
  const completed = session.exercises.filter(isExerciseComplete).map((ex) => ex.name);
  const skipped = session.exercises.filter(isExerciseSkipped).map((ex) => ex.name);
  const cardio = session.exercises
    .map(cardioRecordFor)
    .filter((r): r is CardioRecord => r != null);
  const painSites = Array.from(
    new Set([...session.pain.map((p) => p.site), ...(extras.painSites ?? [])]),
  ).filter(Boolean);

  // 保存每个动作的实际组数据（重量/次数/RPE），让「同一动作的进步」有据可查
  const exerciseSets: ExerciseSetRecord[] = session.exercises.map((ex) => ({
    name: ex.name,
    kind: ex.kind,
    status: ex.status,
    doneSets: ex.sets.filter((s) => s.done).length,
    plannedSets: ex.sets.length,
    sets: ex.sets.map((s, i) => ({
      index: s.index ?? i + 1,
      weightKg: s.weightKg ?? null,
      reps: s.reps ?? null,
      durationSec: s.durationSec ?? null,
      distanceKm: s.distanceKm ?? null,
      rpe: s.rpe ?? null,
      done: Boolean(s.done),
    })),
  }));

  const date: ISODate = toISODate(now);
  return {
    id: uid('sum'),
    sessionId: session.id,
    planId: session.planId,
    planTitle: session.planTitle,
    kind: session.kind,
    date,
    startedAt: session.startedAt,
    endedAt: now.toISOString(),
    totalDurationSec: elapsedSec(session, now.getTime()),
    completedExercises: completed,
    skippedExercises: skipped,
    totalSets: totals.totalSets,
    totalReps: totals.totalReps,
    totalVolumeKg: totals.totalVolumeKg,
    completionRate: totals.completionRate,
    cardio,
    exerciseSets,
    bodyWeightKg: extras.bodyWeightKg ?? null,
    rpe: extras.rpe ?? null,
    fatigue: extras.fatigue ?? null,
    painSites: painSites.length ? painSites : undefined,
    feeling: extras.feeling,
    note: extras.note ?? session.note,
    createdAt: nowISO(),
  };
}

/** 会话完成后的最终状态（保留日志，供归档 / 调试） */
export function finishedSession(session: LiveSession, now: Date = new Date()): LiveSession {
  return {
    ...session,
    status: 'finished',
    endedAt: now.toISOString(),
    accumulatedSec: elapsedSec(session, now.getTime()),
    lastResumedAt: null,
    restUntil: null,
    updatedAt: nowISO(),
    logs: [...session.logs, logEntry('finish')],
  };
}

export const SESSION_KIND_SHORT: Record<SessionKind, string> = {
  strength: '力量',
  run: '跑步',
  ride: '骑行',
  football: '足球',
  stretch: '拉伸',
  recovery: '恢复',
  other: '其他',
};

export const PAIN_SITES = [
  '左膝',
  '右膝',
  '腰部',
  '左踝',
  '右踝',
  '左肩',
  '右肩',
  '手腕',
  '手肘',
  '髋部',
  '腘绳肌',
  '小腿',
  '其他',
] as const;
