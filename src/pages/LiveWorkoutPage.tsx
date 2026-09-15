/**
 * 实时跟练（专注模式）
 *
 * - 一次只显示一个动作，大号「完成本组」按钮，单手可操作；
 * - 每完成一组自动进入休息倒计时（基于绝对时间，锁屏/切后台后回来仍然准确）；
 * - 每一步都写入 IndexedDB，退出后可继续；
 * - 防重复点击：幂等状态机 + 点击节流锁。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  Field,
  ListRow,
  NumberInput,
  Ring,
  Sheet,
  Stepper,
  TextArea,
  useToast,
} from '../components/ui';
import {
  IconBack,
  IconCheck,
  IconHeart,
  IconNote,
  IconPause,
  IconPlay,
  IconPlus,
  IconMinus,
  IconSkip,
} from '../components/icons';
import { useAppData } from '../state/AppData';
import {
  KIND_EMOJI,
  formatClock,
  formatDateShort,
  formatDurationCN,
  formatMinSec,
  formatNumber,
  formatPace,
  kindIsCardio,
  toISODate,
} from '../lib/format';
import {
  PAIN_SITES,
  addSessionNote,
  addSet,
  buildLiveSession,
  clearRest,
  completeSetAndRest,
  currentExercise,
  doneSetCount,
  effectiveTarget,
  elapsedSec,
  finishSession,
  finishedSession,
  goToNext,
  goToPrev,
  isExerciseComplete,
  markExerciseDone,
  nextPendingSet,
  pauseSession,
  plannedSetCount,
  recordPain,
  removeSet,
  restRemainingSec,
  resumeSession,
  SESSION_KIND_SHORT,
  sessionProgress,
  setOverride,
  skipExercise,
  startRest,
  undoSet,
  updateSetRecord,
  type SessionResult,
} from '../lib/session';
import type {
  ExerciseProgress,
  LiveSession,
  SessionKind,
  SetRecord,
  TrainingPlan,
} from '../types';
import './live.css';

interface EditorState {
  weightKg: number | null;
  reps: number | null;
  durationMin: number | null;
  distanceKm: number | null;
  hrBpm: number | null;
  rpe: number | null;
}

const EMPTY_EDITOR: EditorState = {
  weightKg: null,
  reps: null,
  durationMin: null,
  distanceKm: null,
  hrBpm: null,
  rpe: null,
};

function editorFromSet(set: { weightKg: number | null; reps: number | null; durationSec?: number | null; distanceKm?: number | null; hrBpm?: number | null; rpe?: number | null } | null): EditorState {
  if (!set) return EMPTY_EDITOR;
  return {
    weightKg: set.weightKg,
    reps: set.reps,
    durationMin: set.durationSec != null ? Math.round((set.durationSec / 60) * 10) / 10 : null,
    distanceKm: set.distanceKm ?? null,
    hrBpm: set.hrBpm ?? null,
    rpe: set.rpe ?? null,
  };
}

export default function LiveWorkoutPage() {
  const {
    ready,
    plans,
    liveSession,
    setLiveSession,
    saveSummary,
    bodyMetrics,
    settings,
    summaries,
  } = useAppData();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planParam = params.get('plan');
  const toast = useToast();

  const [view, setView] = useState<LiveSession | null>(liveSession);
  const sessionRef = useRef<LiveSession | null>(liveSession);
  const startedRef = useRef(false);
  const tapRef = useRef<{ key: string; t: number }>({ key: '', t: 0 });
  const restNotifiedRef = useRef<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [painOpen, setPainOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [painSite, setPainSite] = useState<string>(PAIN_SITES[0]);
  const [painLevel, setPainLevel] = useState(3);
  const [painNote, setPainNote] = useState('');
  const [adjustWeight, setAdjustWeight] = useState<number | null>(null);
  const [adjustReps, setAdjustReps] = useState('');
  const [adjustRest, setAdjustRest] = useState(90);
  const [noteDraft, setNoteDraft] = useState('');
  const [editSet, setEditSet] = useState<SetRecord | null>(null);
  const [editKind, setEditKind] = useState<SessionKind>('strength');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditorState>(EMPTY_EDITOR);
  const [stashing, setStashing] = useState(false);
  const [finishForm, setFinishForm] = useState({
    weight: '',
    rpe: '',
    fatigue: '',
    feeling: '',
    note: '',
  });

  /* ------------------------------------------------------------ 数据同步 */
  useEffect(() => {
    sessionRef.current = liveSession;
    setView(liveSession);
  }, [liveSession]);

  useEffect(() => {
    if (!view) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [view]);

  const mutate = useCallback(
    (fn: (s: LiveSession) => SessionResult, silent = false): SessionResult | null => {
      const cur = sessionRef.current;
      if (!cur) return null;
      const res = fn(cur);
      if (!res.changed) {
        if (!silent && res.reason) toast(res.reason);
        return res;
      }
      sessionRef.current = res.session;
      setView(res.session);
      void setLiveSession(res.session);
      return res;
    },
    [setLiveSession, toast],
  );

  /**
   * 防连点：同一个目标 400ms 内只接受一次点击，
   * 与状态机的幂等保护形成双重保障（不同目标之间不受影响）。
   */
  const guardTap = useCallback((key: string) => {
    const t = Date.now();
    if (tapRef.current.key === key && t - tapRef.current.t < 400) return false;
    tapRef.current = { key, t };
    return true;
  }, []);

  /* -------------------------------------------------------- 自动开始训练 */
  const today = toISODate();
  const fallbackPlan = useMemo<TrainingPlan | null>(() => {
    const todayPlan = plans.find((p) => !p.archived && p.date === today);
    if (todayPlan) return todayPlan;
    return (
      plans
        .filter((p) => !p.archived)
        .slice()
        .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1))[0] ?? null
    );
  }, [plans, today]);

  const requestedPlan = useMemo<TrainingPlan | null>(
    () => (planParam ? plans.find((p) => p.id === planParam) ?? null : null),
    [planParam, plans],
  );

  useEffect(() => {
    if (!ready || sessionRef.current || startedRef.current) return;
    const plan = requestedPlan ?? fallbackPlan;
    if (!plan) return;
    startedRef.current = true;
    const created = buildLiveSession(plan, { defaultRestSec: settings.defaultRestSec });
    sessionRef.current = created;
    setView(created);
    void setLiveSession(created);
    toast(`开始训练：${plan.title}`);
  }, [ready, requestedPlan, fallbackPlan, settings.defaultRestSec, setLiveSession, toast]);

  const startPlan = useCallback(
    (plan: TrainingPlan) => {
      const created = buildLiveSession(plan, { defaultRestSec: settings.defaultRestSec });
      sessionRef.current = created;
      setView(created);
      void setLiveSession(created);
      toast(`开始训练：${plan.title}`);
    },
    [setLiveSession, settings.defaultRestSec, toast],
  );

  /* ------------------------------------------------------------ 派生数据 */
  const exercise = view ? currentExercise(view) : null;
  const progress = view ? sessionProgress(view) : null;
  const total = view ? elapsedSec(view, nowMs) : 0;
  const restLeft = view ? restRemainingSec(view, nowMs) : 0;
  const target = exercise ? effectiveTarget(exercise) : null;
  const pendingSet = exercise ? nextPendingSet(exercise) : null;
  const isCardio = exercise ? kindIsCardio(exercise.kind) : false;
  const allSetsDone = exercise ? doneSetCount(exercise) >= exercise.sets.length : false;
  const paused = view?.status === 'paused';
  const lastEx = progress ? progress.index >= progress.total - 1 : false;
  const pendingCount = view
    ? view.exercises.filter((ex) => !isExerciseComplete(ex) && ex.status !== 'skipped').length
    : 0;
  /** 除了当前动作之外，还有没有需要完成的动作（已跳过的动作不算） */
  const remainingOthers = view && exercise
    ? view.exercises.filter(
        (ex) =>
          ex.exerciseId !== exercise.exerciseId &&
          !isExerciseComplete(ex) &&
          ex.status !== 'skipped',
      ).length
    : 0;
  const latestWeight = useMemo(() => {
    const rows = bodyMetrics.filter((m) => m.weightKg != null);
    return rows.length ? rows[rows.length - 1].weightKg ?? null : null;
  }, [bodyMetrics]);

  /** 当前动作可以收尾（所有组完成 / 已标记完成 / 已经没有待完成动作） */
  const showPrimaryFinish = allSetsDone || exercise?.status === 'done' || pendingCount === 0;
  /** 收尾后整个训练就结束了 */
  const finishEverything = lastEx || remainingOthers === 0;

  useEffect(() => {
    setEditor(editorFromSet(pendingSet));
  }, [pendingSet?.id]);

  /* --------------------------------------------------------- 休息结束提示 */
  useEffect(() => {
    if (!view?.restUntil) {
      restNotifiedRef.current = null;
      return;
    }
    if (restLeft > 0) return;
    if (restNotifiedRef.current === view.restUntil) return;
    restNotifiedRef.current = view.restUntil;
    mutate((s) => clearRest(s), true);
    toast('休息结束，可以开始下一组');
  }, [view?.restUntil, restLeft, mutate, toast]);

  /* ------------------------------------------------------------- 操作封装 */
  const onCompleteSet = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const ex = currentExercise(cur);
    const set = ex ? nextPendingSet(ex) : null;
    if (!guardTap(`set:${set?.id ?? ex?.exerciseId ?? 'none'}`)) return;
    if (!ex || !set) {
      toast('这个动作的组数都完成了，点击下方按钮进入下一项');
      return;
    }
    const patch = isCardio
      ? {
          durationSec: editor.durationMin != null ? Math.round(editor.durationMin * 60) : null,
          distanceKm: editor.distanceKm,
          hrBpm: editor.hrBpm,
          rpe: editor.rpe,
        }
      : { weightKg: editor.weightKg, reps: editor.reps, rpe: editor.rpe };
    const res = mutate((s) => completeSetAndRest(s, set.id, patch, settings.defaultRestSec));
    if (res?.changed) {
      const nextEx = res.session.exercises.find((x) => x.exerciseId === ex.exerciseId);
      const restSec = effectiveTarget(nextEx ?? ex).restSec ?? settings.defaultRestSec;
      if (nextEx && nextEx.sets.some((s) => !s.done)) {
        toast(`第 ${doneSetCount(nextEx)} 组完成，休息 ${formatMinSec(restSec)}`);
      } else {
        toast('本动作全部完成！');
      }
    }
  }, [editor, guardTap, isCardio, mutate, settings.defaultRestSec, toast]);

  const onFinishExercise = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const ex = currentExercise(cur);
    if (!ex) return;
    if (!guardTap(`finish:${ex.exerciseId}`)) return;
    const rest = cur.exercises.filter(
      (item) =>
        item.exerciseId !== ex.exerciseId &&
        !isExerciseComplete(item) &&
        item.status !== 'skipped',
    ).length;
    const alreadyDone = ex.status === 'done';
    const res = alreadyDone ? null : mutate((s) => markExerciseDone(s, ex.exerciseId));
    if (!alreadyDone && !res?.changed) return;
    if (rest === 0) {
      setFinishOpen(true);
    } else {
      const next = res?.session.exercises[res.session.currentIndex];
      toast(`完成「${ex.name}」，下一个：${next?.name ?? '全部完成'}`);
    }
  }, [guardTap, mutate, toast]);

  const onSaveAdjust = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const ex = currentExercise(cur);
    if (!ex) return;
    mutate((s) =>
      setOverride(s, ex.exerciseId, {
        weightKg: adjustWeight,
        reps: adjustReps.trim() || null,
        restSec: adjustRest,
      }),
    );
    if (noteDraft.trim()) {
      mutate((s) => addSessionNote(s, noteDraft, ex.exerciseId), true);
    }
    setAdjustOpen(false);
    setNoteDraft('');
    toast('已更新本动作的目标');
  }, [adjustReps, adjustRest, adjustWeight, mutate, noteDraft, toast]);

  const onSavePain = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const ex = currentExercise(cur);
    const res = mutate((s) =>
      recordPain(s, { site: painSite, level: painLevel, note: painNote, exerciseId: ex?.exerciseId }),
    );
    if (res?.changed) {
      setPainOpen(false);
      setPainNote('');
      toast('已记录疼痛，注意安全，必要时停止训练');
    }
  }, [mutate, painLevel, painNote, painSite, toast]);

  const onFinishSession = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur) return;
    const summary = finishSession(cur, {
      bodyWeightKg: finishForm.weight ? Number(finishForm.weight) : latestWeight,
      rpe: finishForm.rpe ? Number(finishForm.rpe) : null,
      fatigue: finishForm.fatigue ? Number(finishForm.fatigue) : null,
      feeling: finishForm.feeling.trim() || undefined,
      note: finishForm.note.trim() || undefined,
    });
    try {
      await saveSummary(summary);
      // 先把会话标记为已完成（避免重新打开应用时又恢复这次训练），再清空内存状态
      await setLiveSession(finishedSession(cur, new Date(summary.endedAt)));
      await setLiveSession(null);
      sessionRef.current = null;
      setView(null);
      setFinishOpen(false);
      toast('训练已保存，正在生成今日总结');
      navigate(`/summary?date=${summary.date}`);
    } catch (err) {
      console.error('[live] 保存总结失败', err);
      toast('保存失败，请重试', 'error');
    }
  }, [finishForm, latestWeight, navigate, saveSummary, setLiveSession, toast]);

  const onExit = useCallback(() => {
    const cur = sessionRef.current;
    if (cur) void setLiveSession(cur);
    setExitOpen(false);
    toast('进度已保存，可以随时继续');
    navigate('/');
  }, [navigate, setLiveSession, toast]);

  /**
   * 暂存训练：把当前进度（含已完成组、重量、次数、RPE、备注、休息状态）
   * 原样保存在本机，下次打开可继续，不生成训练记录。
   */
  const onStash = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur || stashing) return;
    setStashing(true);
    try {
      const next = cur.status === 'active' ? pauseSession(cur).session : cur;
      await setLiveSession(next);
      sessionRef.current = next;
      setView(next);
      setPauseOpen(false);
      toast('已暂存训练，下次进入可继续', 'success');
      navigate('/');
    } catch (err) {
      console.error('[live] 暂存失败', err);
      toast('暂存失败，请重试', 'error');
    } finally {
      setStashing(false);
    }
  }, [navigate, setLiveSession, stashing, toast]);

  /** 保存已完成组的修改（可改重量/次数/RPE/时长/距离/心率） */
  const onSaveSetEdit = useCallback(() => {
    if (!editSet) return;
    const patch = kindIsCardio(editKind)
      ? {
          durationSec:
            editForm.durationMin != null ? Math.round(editForm.durationMin * 60) : null,
          distanceKm: editForm.distanceKm,
          hrBpm: editForm.hrBpm,
          rpe: editForm.rpe,
        }
      : {
          weightKg: editForm.weightKg,
          reps: editForm.reps,
          rpe: editForm.rpe,
        };
    const res = mutate((s) => updateSetRecord(s, editSet.id, patch));
    if (res?.changed) {
      setEditOpen(false);
      setEditSet(null);
      toast('已保存这一组的修改', 'success');
    }
  }, [editForm, editKind, editSet, mutate, toast]);

  /* --------------------------------------------------------------- 渲染 */
  if (!ready) {
    return (
      <div className="focus">
        <div className="focus-body">
          <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius)' }} />
          <div style={{ height: 12 }} />
          <div className="skeleton" style={{ height: 200, borderRadius: 'var(--radius)' }} />
        </div>
      </div>
    );
  }

  if (!view || !exercise || !progress || !target) {
    return (
      <div className="focus">
        <div className="focus-top">
          <button className="icon-btn" aria-label="返回" onClick={() => navigate('/')}>
            <IconBack width={22} height={22} />
          </button>
          <div className="grow">
            <div className="nav-title">实时跟练</div>
            <div className="nav-sub">选择一个计划开始</div>
          </div>
        </div>
        <div className="focus-body">
          {plans.length === 0 ? (
            <EmptyState
              emoji="📋"
              title="还没有训练计划"
              desc="先在训练页创建或导入一份计划，再回来开始训练"
              action={
                <Button variant="primary" size="lg" onClick={() => navigate('/train')}>
                  去创建计划
                </Button>
              }
            />
          ) : (
            <>
              <div className="section-title">选择今天要练的计划</div>
              <Card flat>
                <div className="list">
                  {plans
                    .filter((p) => !p.archived)
                    .slice()
                    .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1))
                    .map((p) => (
                      <ListRow
                        key={p.id}
                        title={`${KIND_EMOJI[p.kind]} ${p.title}`}
                        sub={`${formatDateShort(p.date)} · ${p.exercises.length} 个动作`}
                        onClick={() => startPlan(p)}
                        testId="live-plan-start"
                      />
                    ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    );
  }

  const restTotal = view.restTotalSec || settings.defaultRestSec;
  const restProgress = restLeft > 0 ? 1 - restLeft / restTotal : 0;
  const elapsedText = formatClock(total);
  const cardio = isCardio;
  const doneSets = doneSetCount(exercise);

  return (
    <div className="focus">
      <div className="focus-top">
        <button
          className="icon-btn"
          aria-label="退出"
          onClick={() => setExitOpen(true)}
          data-testid="live-exit"
        >
          <IconBack width={22} height={22} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tiny muted truncate">{view.planTitle}</div>
          <div className="strong" data-testid="live-progress">
            动作 {progress.index + 1}/{progress.total}
          </div>
        </div>
        <div className="lw-timer" data-testid="live-elapsed">
          {elapsedText}
        </div>
        <button
          className="icon-btn"
          aria-label={paused ? '恢复训练' : '暂停训练'}
          onClick={() => {
            if (paused) {
              const res = mutate((s) => resumeSession(s));
              if (res?.changed) toast('继续训练');
            } else {
              mutate((s) => pauseSession(s));
              setPauseOpen(true);
            }
          }}
          data-testid={paused ? 'live-resume' : 'live-pause'}
        >
          {paused ? <IconPlay width={22} height={22} /> : <IconPause width={22} height={22} />}
        </button>
      </div>

      <div className="lw-progress">
        <i style={{ width: `${Math.round(progress.rate * 100)}%` }} />
      </div>

      <div className="focus-body">
        {paused ? (
          <Card className="lw-paused">
            <div className="lw-paused-emoji">⏸</div>
            <div className="strong" style={{ fontSize: 22 }}>
              训练已暂停
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              已训练 {formatClock(total)} · 计时已停止
            </div>
            <div className="col" style={{ gap: 10, marginTop: 18 }}>
              <Button
                block
                variant="primary"
                size="lg"
                onClick={() => {
                  const res = mutate((s) => resumeSession(s));
                  if (res?.changed) {
                    setPauseOpen(false);
                    toast('继续训练');
                  }
                }}
                data-testid="live-resume-button"
              >
                恢复训练
              </Button>
              <Button block size="lg" onClick={() => setFinishOpen(true)}>
                结束并保存
              </Button>
            </div>
          </Card>
        ) : restLeft > 0 ? (
          <div className="lw-rest">
            <div className="muted small">组间休息</div>
            <Ring progress={restProgress} size={200} stroke={14} tone="var(--green)">
              <div>
                <div className="lw-rest-time" data-testid="live-rest-timer">
                  {formatClock(restLeft)}
                </div>
                <div className="tiny muted">休息中</div>
              </div>
            </Ring>
            <div className="small muted" style={{ marginTop: 14 }}>
              下一组：{exercise.name}
              {target.reps ? ` · ${target.reps} 次` : ''}
              {target.weightKg != null ? ` · ${formatNumber(target.weightKg)}kg` : ''}
            </div>
            <div
              className="tiny muted center"
              style={{ marginTop: 8 }}
              data-testid="live-progress-done"
            >
              已完成 {progress.doneSets}/{progress.plannedSets} 组 · 剩余 {pendingCount} 个动作 ·
              自动保存中
            </div>
            <div className="col" style={{ gap: 10, marginTop: 16, width: '100%', maxWidth: 420 }}>
              <Button
                block
                size="lg"
                onClick={() => mutate((s) => clearRest(s))}
                data-testid="live-rest-skip"
              >
                跳过休息，马上开始
              </Button>
              <Button
                block
                size="lg"
                onClick={() =>
                  mutate((s) =>
                    startRest(
                      s,
                      restRemainingSec(s) + 30,
                      s.restAfterExerciseId ?? undefined,
                    ),
                  )
                }
              >
                延长 30 秒
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="lw-head">
              <span className="lw-kind">
                {KIND_EMOJI[exercise.kind]} {SESSION_KIND_SHORT[exercise.kind]}
                {isCardio ? '专项记录' : '训练'}
              </span>
              <div className="exercise-name" data-testid="live-exercise-name">
                {exercise.name}
              </div>
              <div className="wrap" style={{ marginTop: 8 }}>
                <Chip tone="accent">
                  {plannedSetCount(exercise)} 组
                  {target.reps ? ` × ${target.reps}` : ''}
                </Chip>
                {target.weightKg != null && (
                  <Chip>{formatNumber(target.weightKg)} kg</Chip>
                )}
                {target.weightText && <Chip>{target.weightText}</Chip>}
                {target.durationSec != null && (
                  <Chip>{formatMinSec(target.durationSec)}</Chip>
                )}
                {target.distanceKm != null && (
                  <Chip>{formatNumber(target.distanceKm, 2)} km</Chip>
                )}
                {target.paceText && <Chip>{target.paceText}</Chip>}
                {target.speedKph != null && <Chip>{formatNumber(target.speedKph)} km/h</Chip>}
                {target.hrBpm != null && <Chip tone="red">心率 {target.hrBpm}</Chip>}
                {target.playMin != null && <Chip tone="green">上场 {target.playMin} 分钟</Chip>}
                {target.rpe != null && <Chip tone="orange">RPE {target.rpe}</Chip>}
                <Chip tone="default">休息 {formatMinSec(effectiveTarget(exercise).restSec ?? settings.defaultRestSec)}</Chip>
              </div>
              {(exercise.cue || exercise.notes) && (
                <div className="lw-cue">
                  {exercise.cue && (
                    <div className="row" style={{ gap: 6 }}>
                      <IconNote width={16} height={16} />
                      <span className="small">{exercise.cue}</span>
                    </div>
                  )}
                  {exercise.notes && (
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <IconHeart width={16} height={16} />
                      <span className="small muted">{exercise.notes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Card className="lw-sets">
              <div className="row-between">
                <span className="strong">本组记录</span>
                <span className="tiny muted">
                  {doneSets}/{exercise.sets.length} 组已完成
                </span>
              </div>
              <div className="set-dots" style={{ marginTop: 10 }}>
                {exercise.sets.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`set-dot ${s.done ? 'done' : ''} ${
                      !s.done && s.id === pendingSet?.id ? 'current' : ''
                    }`}
                    aria-label={
                      s.done
                        ? `已完成的第 ${i + 1} 组，点击可修改或取消完成`
                        : `第 ${i + 1} 组`
                    }
                    data-testid={`set-dot-${i + 1}`}
                    onClick={() => {
                      if (!s.done) return;
                      setEditSet(s);
                      setEditKind(exercise.kind);
                      setEditForm({
                        weightKg: s.weightKg,
                        reps: s.reps,
                        rpe: s.rpe ?? null,
                        durationMin: s.durationSec != null ? s.durationSec / 60 : null,
                        distanceKm: s.distanceKm ?? null,
                        hrBpm: s.hrBpm ?? null,
                      });
                      setEditOpen(true);
                    }}
                  >
                    {s.done ? '✓' : i + 1}
                  </button>
                ))}
              </div>

              {pendingSet ? (
                <div className="lw-inputs">
                  {cardio ? (
                    <>
                      <div className="lw-cardio-head">
                        {exercise.kind === 'football'
                          ? '⚽ 足球专项记录'
                          : exercise.kind === 'ride'
                            ? '🚴 骑行记录'
                            : '🏃 跑步记录'}
                      </div>
                      <Field
                        label={exercise.kind === 'football' ? '上场时间（分钟）' : '实际时长（分钟）'}
                      >
                        <NumberInput
                          value={editor.durationMin}
                          onChange={(v) => setEditor((e) => ({ ...e, durationMin: v }))}
                          placeholder={
                            target.durationSec ? String(Math.round(target.durationSec / 60)) : '0'
                          }
                          testId="live-cardio-duration"
                        />
                      </Field>
                      <Field label="实际距离（km）">
                        <NumberInput
                          value={editor.distanceKm}
                          onChange={(v) => setEditor((e) => ({ ...e, distanceKm: v }))}
                          dec={2}
                          placeholder={
                            target.distanceKm != null ? String(target.distanceKm) : '0'
                          }
                          testId="live-cardio-distance"
                        />
                      </Field>
                      <Field label="平均心率">
                        <NumberInput
                          value={editor.hrBpm}
                          onChange={(v) => setEditor((e) => ({ ...e, hrBpm: v }))}
                          dec={0}
                          placeholder={target.hrBpm != null ? String(target.hrBpm) : '—'}
                          testId="live-cardio-hr"
                        />
                      </Field>
                      <Field label="本组 RPE">
                        <NumberInput
                          value={editor.rpe}
                          onChange={(v) => setEditor((e) => ({ ...e, rpe: v }))}
                          dec={0}
                          placeholder="6-8"
                          testId="live-set-rpe"
                        />
                      </Field>
                      {(editor.durationMin != null && editor.distanceKm != null) && (
                        <div className="lw-cardio-hint">
                          本次配速{' '}
                          {formatPace(editor.distanceKm, Math.round(editor.durationMin * 60))} ·
                          平均速度{' '}
                          {formatNumber(
                            editor.distanceKm / (Math.max(editor.durationMin, 0.1) / 60),
                          )}{' '}
                          km/h
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <Field label="实际重量（kg）">
                        <NumberInput
                          value={editor.weightKg}
                          onChange={(v) => setEditor((e) => ({ ...e, weightKg: v }))}
                          placeholder={target.weightKg != null ? String(target.weightKg) : '—'}
                          testId="live-set-weight"
                        />
                      </Field>
                      <Field label="实际次数">
                        <NumberInput
                          value={editor.reps}
                          onChange={(v) => setEditor((e) => ({ ...e, reps: v }))}
                          dec={0}
                          placeholder={target.reps ?? '10'}
                          testId="live-set-reps"
                        />
                      </Field>
                      <Field label="本组 RPE">
                        <NumberInput
                          value={editor.rpe}
                          onChange={(v) => setEditor((e) => ({ ...e, rpe: v }))}
                          dec={0}
                          placeholder="6-8"
                          testId="live-set-rpe"
                        />
                      </Field>
                    </>
                  )}
                </div>
              ) : (
                <div className="lw-done-hint">
                  <IconCheck width={18} height={18} />
                  <span className="small">本动作的 {exercise.sets.length} 组都完成了</span>
                </div>
              )}

              {doneSets > 0 && (
                <div className="lw-history">
                  {exercise.sets
                    .filter((s) => s.done)
                    .map((s) => (
                      <div className="lw-history-row" key={s.id}>
                        <span className="tiny muted">第 {s.index} 组</span>
                        <span className="small strong">
                          {s.weightKg != null ? `${formatNumber(s.weightKg)}kg` : ''}
                          {s.weightKg != null && s.reps != null ? ' × ' : ''}
                          {s.reps != null ? `${s.reps} 次` : ''}
                          {s.durationSec != null ? formatMinSec(s.durationSec) : ''}
                          {s.distanceKm != null ? ` · ${formatNumber(s.distanceKm, 2)}km` : ''}
                          {s.hrBpm != null ? ` · ❤️${s.hrBpm}` : ''}
                        </span>
                        <button
                          className="link tiny"
                          onClick={() => mutate((st) => undoSet(st, s.id))}
                        >
                          撤销
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </Card>

            {view.pain.length > 0 && (
              <Card flat className="lw-pain-list">
                {view.pain.map((p) => (
                  <div className="row-between" key={p.id}>
                    <span className="small">
                      ⚠️ {p.site} · {p.level}/10
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                    <span className="tiny muted">
                      {new Date(p.at).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </Card>
            )}

            <div className="lw-actions">
              <button className="lw-action" onClick={() => mutate((s) => goToPrev(s))} data-testid="live-prev">
                <IconBack width={18} height={18} />
                <span>上一项</span>
              </button>
              <button className="lw-action" onClick={() => mutate((s) => goToNext(s))} data-testid="live-next">
                <IconSkip width={18} height={18} />
                <span>下一项</span>
              </button>
              <button
                className="lw-action"
                onClick={() => mutate((s) => addSet(s, exercise.exerciseId))}
                data-testid="live-add-set"
              >
                <IconPlus width={18} height={18} />
                <span>加一组</span>
              </button>
              <button
                className="lw-action"
                onClick={() => mutate((s) => removeSet(s, exercise.exerciseId))}
                data-testid="live-remove-set"
              >
                <IconMinus width={18} height={18} />
                <span>减一组</span>
              </button>
              <button
                className="lw-action"
                onClick={() => {
                  const cur = sessionRef.current;
                  const ex = cur ? currentExercise(cur) : null;
                  setAdjustWeight(target.weightKg ?? ex?.override?.weightKg ?? null);
                  setAdjustReps(target.reps ?? '');
                  setAdjustRest(effectiveTarget(exercise).restSec ?? settings.defaultRestSec);
                  setAdjustOpen(true);
                }}
                data-testid="live-adjust-open"
              >
                <IconNote width={18} height={18} />
                <span>调整</span>
              </button>
              <button
                className="lw-action"
                onClick={() => setPainOpen(true)}
                data-testid="live-pain-open"
              >
                <IconHeart width={18} height={18} />
                <span>疼痛</span>
              </button>
              <button
                className="lw-action danger"
                onClick={() => mutate((s) => skipExercise(s, exercise.exerciseId))}
                data-testid="live-skip"
              >
                <IconSkip width={18} height={18} />
                <span>跳过动作</span>
              </button>
            </div>
          </>
        )}
      </div>

      {!paused && restLeft <= 0 && (
        <div className="focus-bottom">
          <div className="focus-bottom-inner">
            {showPrimaryFinish ? (
              <Button
                block
                variant="success"
                size="xl"
                onClick={onFinishExercise}
                data-testid={finishEverything ? 'live-finish-session' : 'live-finish-exercise'}
              >
                {finishEverything ? '完成训练并生成总结' : '完成本动作并进入下一项'}
              </Button>
            ) : (
              <Button
                block
                variant="primary"
                size="xl"
                onClick={onCompleteSet}
                data-testid="live-complete-set"
              >
                完成本组 {doneSets + 1}/{exercise.sets.length}
              </Button>
            )}
            <div
              className="tiny muted center"
              style={{ marginTop: 8 }}
              data-testid="live-progress-done"
            >
              已完成 {progress.doneSets}/{progress.plannedSets} 组 · 剩余 {pendingCount} 个动作 ·
              {` 已自动保存 ${new Date(view.updatedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}`}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <Button
                block
                size="lg"
                disabled={stashing}
                data-testid="live-stash"
                onClick={() => void onStash()}
              >
                {stashing ? '暂存中…' : '暂存训练'}
              </Button>
              <Button
                block
                size="lg"
                variant="ghost"
                data-testid="live-finish-open"
                onClick={() => setFinishOpen(true)}
              >
                保存并结束训练
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 调整弹层 */}
      <Sheet
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="临时调整本动作"
        footer={
          <Button block variant="primary" size="lg" onClick={onSaveAdjust}>
            保存调整
          </Button>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          只影响这个动作中还没完成的组，不会修改原计划。
        </p>
        <div className="col" style={{ gap: 12 }}>
          <Field label="重量（kg）">
            <NumberInput value={adjustWeight} onChange={setAdjustWeight} testId="live-adjust-weight" />
          </Field>
          <Field label="次数">
            <TextInputLike value={adjustReps} onChange={setAdjustReps} />
          </Field>
          <Field label="组间休息（秒）">
            <Stepper value={adjustRest} onChange={setAdjustRest} step={15} min={15} max={600} />
          </Field>
          <Field label="本动作备注（可选）">
            <TextArea value={noteDraft} onChange={setNoteDraft} rows={2} placeholder="例如：右膝有点紧，降低幅度" />
          </Field>
        </div>
      </Sheet>

      {/* 已完成组编辑（可改数据或取消完成） */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`第 ${editSet?.index ?? 1} 组记录`}
        footer={
          <div className="col" style={{ gap: 10 }}>
            <Button block variant="primary" size="lg" onClick={onSaveSetEdit} data-testid="set-edit-save">
              保存修改
            </Button>
            <Button
              block
              variant="danger"
              size="lg"
              data-testid="set-edit-undo"
              onClick={() => {
                if (!editSet) return;
                const res = mutate((s) => undoSet(s, editSet.id));
                if (res?.changed) {
                  toast('已取消完成这一组');
                  setEditOpen(false);
                  setEditSet(null);
                }
              }}
            >
              取消完成（这一组重新记录）
            </Button>
          </div>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          {kindIsCardio(editKind) ? (
            <>
              <Field label="实际时长（分钟）">
                <NumberInput
                  value={editForm.durationMin}
                  onChange={(v) => setEditForm((e) => ({ ...e, durationMin: v }))}
                  testId="set-edit-duration"
                />
              </Field>
              <Field label="实际距离（km）">
                <NumberInput
                  value={editForm.distanceKm}
                  dec={2}
                  onChange={(v) => setEditForm((e) => ({ ...e, distanceKm: v }))}
                />
              </Field>
              <Field label="平均心率">
                <NumberInput
                  value={editForm.hrBpm}
                  dec={0}
                  onChange={(v) => setEditForm((e) => ({ ...e, hrBpm: v }))}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="实际重量（kg）">
                <NumberInput
                  value={editForm.weightKg}
                  onChange={(v) => setEditForm((e) => ({ ...e, weightKg: v }))}
                  testId="set-edit-weight"
                />
              </Field>
              <Field label="实际次数">
                <NumberInput
                  value={editForm.reps}
                  dec={0}
                  onChange={(v) => setEditForm((e) => ({ ...e, reps: v }))}
                  testId="set-edit-reps"
                />
              </Field>
            </>
          )}
          <Field label="本组 RPE（1-10）">
            <NumberInput
              value={editForm.rpe}
              dec={0}
              onChange={(v) => setEditForm((e) => ({ ...e, rpe: v }))}
              testId="set-edit-rpe"
            />
          </Field>
          <div className="tiny muted">
            修改与取消完成都会立即写入本机数据库，刷新或锁屏后依然保留。
          </div>
        </div>
      </Sheet>

      {/* 疼痛弹层 */}
      <Sheet
        open={painOpen}
        onClose={() => setPainOpen(false)}
        title="记录疼痛或不适"
        footer={
          <Button block variant="danger" size="lg" onClick={onSavePain} data-testid="live-pain-save">
            记录
          </Button>
        }
      >
        <p className="small muted" style={{ marginTop: 0 }}>
          如果疼痛明显或持续，请立即停止训练。
        </p>
        <div className="wrap" style={{ gap: 8 }}>
          {PAIN_SITES.map((site) => (
            <button
              key={site}
              className={`chip pain-chip ${painSite === site ? 'accent' : ''}`}
              onClick={() => setPainSite(site)}
              data-testid="live-pain-site"
            >
              {site}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label={`疼痛等级：${painLevel}/10`}>
            <Stepper value={painLevel} onChange={setPainLevel} min={1} max={10} />
          </Field>
        </div>
        <Field label="备注（可选）">
          <TextArea value={painNote} onChange={setPainNote} rows={2} placeholder="什么动作、什么感觉" />
        </Field>
      </Sheet>

      {/* 暂停说明 */}
      <Sheet open={pauseOpen} onClose={() => setPauseOpen(false)} title="训练已暂停">
        <p className="muted" style={{ marginTop: 0 }}>
          计时已经停止，随时可以继续。所有已完成的数据都已经保存在本机。
        </p>
        <div className="col" style={{ gap: 10 }}>
          <Button
            block
            variant="primary"
            size="lg"
            onClick={() => {
              const res = mutate((s) => resumeSession(s));
              if (res?.changed) {
                setPauseOpen(false);
                toast('继续训练');
              }
            }}
          >
            继续训练
          </Button>
          <Button block size="lg" onClick={() => setPauseOpen(false)}>
            留在暂停状态
          </Button>
          <Button
            block
            size="lg"
            onClick={() => {
              setPauseOpen(false);
              setFinishOpen(true);
            }}
            data-testid="live-end-early"
          >
            保存并结束训练
          </Button>
          <Button
            block
            size="lg"
            disabled={stashing}
            onClick={() => void onStash()}
            data-testid="live-stash-paused"
          >
            {stashing ? '暂存中…' : '暂存训练（保留进度）'}
          </Button>
        </div>
      </Sheet>

      {/* 结束训练 */}
      <Sheet
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="结束训练并保存总结"
        footer={
          <Button
            block
            variant="primary"
            size="xl"
            onClick={onFinishSession}
            data-testid="live-finish-confirm"
          >
            保存总结
          </Button>
        }
      >
        <div className="stat-grid three">
          <div className="stat">
            <div className="label">总时长</div>
            <div className="value">{formatDurationCN(total)}</div>
          </div>
          <div className="stat">
            <div className="label">完成组数</div>
            <div className="value">{progress.doneSets}</div>
          </div>
          <div className="stat">
            <div className="label">完成率</div>
            <div className="value">{Math.round(progress.rate * 100)}%</div>
          </div>
        </div>
        <div className="col" style={{ gap: 12, marginTop: 12 }}>
          <Field label="当日体重（kg）" hint={latestWeight != null ? `上次记录：${formatNumber(latestWeight)}kg` : undefined}>
            <TextInputLike
              value={finishForm.weight}
              onChange={(v) => setFinishForm((f) => ({ ...f, weight: v }))}
              placeholder={latestWeight != null ? String(latestWeight) : '例如 71.5'}
              testId="live-finish-weight"
            />
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <div className="grow">
              <Field label="训练 RPE（1-10）">
                <TextInputLike
                  value={finishForm.rpe}
                  onChange={(v) => setFinishForm((f) => ({ ...f, rpe: v }))}
                  placeholder="8"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="疲劳程度（1-10）">
                <TextInputLike
                  value={finishForm.fatigue}
                  onChange={(v) => setFinishForm((f) => ({ ...f, fatigue: v }))}
                  placeholder="6"
                />
              </Field>
            </div>
          </div>
          <Field label="今日感受">
            <TextInputLike
              value={finishForm.feeling}
              onChange={(v) => setFinishForm((f) => ({ ...f, feeling: v }))}
              placeholder="例如：状态不错，深蹲很稳"
            />
          </Field>
          <Field label="备注">
            <TextArea
              value={finishForm.note}
              onChange={(v) => setFinishForm((f) => ({ ...f, note: v }))}
              rows={3}
              placeholder="下次要调整的地方"
            />
          </Field>
        </div>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          已记录 {summaries.length} 次历史训练 · 保存后会同步到「数据」和「总结」页面
        </div>
      </Sheet>

      <Confirm
        open={exitOpen}
        title="退出跟练？"
        message="进度会自动保存在本机，下次进入可以从这里继续。"
        confirmText="退出并保留进度"
        onConfirm={onExit}
        onCancel={() => setExitOpen(false)}
      />
    </div>
  );
}

/** 精简文本框（沿用全局 .input 样式，避免额外依赖） */
function TextInputLike({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <input
      className="input"
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 供外部（如首页）复用：判断是否有未完成的动作 */
export function unfinishedCount(exercises: ExerciseProgress[]): number {
  return exercises.filter((ex) => !isExerciseComplete(ex) && ex.status !== 'skipped').length;
}
