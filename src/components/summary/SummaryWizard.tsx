/**
 * 逐步引导式「今日总结」
 * ① 今天的训练 → ② Apple Watch 截图识别 → ③ 睡眠截图识别 → ④ 强度与身体感受
 * → ⑤ 今日补剂 → ⑥ 其他补充（可跳过） → ⑦ 确认并保存
 *
 * 每一步都会自动保存草稿（status: 'draft'），刷新/退出后可继续上次进度；
 * 最后点击「保存今日总结」才正式归档（status: 'final'），同一天只更新同一条记录。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DailyLog,
  ISODate,
  MealLog,
  SessionKind,
  SupplementEntry,
  TrainingSection,
  WorkoutSummary,
} from '../../types';
import { SESSION_KIND_LABEL } from '../../types';
import {
  Button,
  Card,
  Chip,
  Field,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  useToast,
} from '../ui';
import { IconCheck, IconPlus, IconTrash } from '../icons';
import { useAppData } from '../../state/AppData';
import { formatDateCN, formatDurationCN, formatNumber, nowISO, uid } from '../../lib/format';
import { normalizeDailyLog } from '../../lib/summary/sections';
import { ScreenshotStep } from './ScreenshotStep';
import { TrainingSessionsCard } from './TrainingSessionsCard';
import { sleepDurationText } from '../../lib/ocr/parse';

const STEPS = [
  { key: 'training', title: '今天的训练', emoji: '🏋️', hint: '确认今天练了什么；休息日可以直接选「今天未训练」' },
  { key: 'watch', title: 'Apple Watch 运动数据', emoji: '⌚️', hint: '上传截图自动识别运动时长、动态热量、心率等，可修改后再继续' },
  { key: 'sleep', title: '睡眠记录', emoji: '😴', hint: '上传睡眠截图自动识别，也可以手动补充' },
  { key: 'intensity', title: '训练强度与身体感受', emoji: '💪', hint: '点选即可，尽量少打字' },
  { key: 'supplements', title: '今日补剂', emoji: '🥤', hint: '蛋白粉、肌酸或自定义补剂；今天没吃也可以直接选' },
  { key: 'extra', title: '其他补充（可跳过）', emoji: '📝', hint: '饮食、饮水与自由记录' },
  { key: 'review', title: '确认并保存', emoji: '✅', hint: '检查今天的完整摘要，确认无误后保存归档' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

const PRESET_SUPPLEMENTS = ['蛋白粉', '肌酸', '咖啡因', '维生素 D', '镁', '鱼油'];

function statusText(status: SaveStatus, at: string | null): string {
  if (status === 'saving') return '保存中…';
  if (status === 'dirty') return '有修改，稍后自动保存';
  if (status === 'error') return '保存失败，请重试';
  if (status === 'saved' && at) {
    return `已保存 ${new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return '填写后自动保存在本机';
}

export interface SummaryWizardProps {
  date: ISODate;
  log: DailyLog | null;
  /** 打开完整表单（高级编辑） */
  onOpenAdvanced: () => void;
  onFinalized?: () => void;
}

export function SummaryWizard({ date, log, onOpenAdvanced, onFinalized }: SummaryWizardProps) {
  const toast = useToast();
  const { summaries, saveDailyLog, saveBodyMetric } = useAppData();

  const [draft, setDraft] = useState<DailyLog>(() => normalizeDailyLog(log, date));
  const [started, setStarted] = useState(() => log?.status === 'draft');
  const [editingFinal, setEditingFinal] = useState(false);
  const [stepIndex, setStepIndex] = useState(() => {
    const saved = log?.lastStep as StepKey | undefined;
    const idx = STEPS.findIndex((s) => s.key === saved);
    return idx >= 0 ? idx : 0;
  });
  const [status, setStatus] = useState<SaveStatus>('clean');
  const [savedAt, setSavedAt] = useState<string | null>(log?.updatedAt ?? null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const dateRef = useRef(date);

  // 切换日期时重新载入
  useEffect(() => {
    if (dateRef.current === date) return;
    dateRef.current = date;
    dirty.current = false;
    setDraft(normalizeDailyLog(log, date));
    setStatus('clean');
    setSavedAt(log?.updatedAt ?? null);
    const idx = STEPS.findIndex((s) => s.key === (log?.lastStep as StepKey | undefined));
    setStepIndex(idx >= 0 ? idx : 0);
    setStarted(log?.status === 'draft');
    setEditingFinal(false);
  }, [date, log]);

  const step = STEPS[stepIndex];
  const daySummaries = useMemo(() => summaries.filter((s) => s.date === date), [summaries, date]);

  const patch = useCallback((fn: (prev: DailyLog) => DailyLog) => {
    setDraft((prev) => fn(prev));
    dirty.current = true;
    setStatus('dirty');
  }, []);

  const patchTraining = useCallback(
    (value: Partial<TrainingSection>) =>
      patch((prev) => ({ ...prev, training: { ...prev.training, ...value } })),
    [patch],
  );
  const patchMeals = useCallback(
    (value: Partial<MealLog>) => patch((prev) => ({ ...prev, meals: { ...prev.meals, ...value } })),
    [patch],
  );
  const patchSupplements = useCallback(
    (value: Partial<NonNullable<DailyLog['supplements']>>) =>
      patch((prev) => ({ ...prev, supplements: { ...prev.supplements, ...value } })),
    [patch],
  );

  /** 自动保存草稿 */
  const persist = useCallback(
    async (opts: { final?: boolean } = {}) => {
      setStatus('saving');
      setSaving(true);
      try {
        const training = draft.training ?? {};
        const sessions = training.sessions ?? [];
        const body = draft.body ?? {};
        const sleep = draft.sleep ?? {};
        const saved = await saveDailyLog({
          ...draft,
          date,
          id: date,
          // 训练次数以训练卡片数量为准
          training: sessions.length ? { ...training, sessionCount: sessions.length } : training,
          status: opts.final ? 'final' : 'draft',
          finalizedAt: opts.final ? nowISO() : draft.finalizedAt,
          lastStep: step.key,
          completedSteps: draft.completedSteps ?? [],
          // 兼容字段，其它页面继续可用
          weightKg: body.weightKg ?? null,
          fatigue: body.fatigue ?? null,
          pain: body.injuryPain ?? '',
          feeling: body.overall ?? training.feeling ?? '',
          rpe: training.rpe ?? null,
          trainingContent: training.items ?? '',
          trainingVolumeKg: training.volumeKg ?? null,
          sleepHours: sleep.totalHours ?? null,
          diet: draft.meals?.note ?? '',
          note: draft.freeNote ?? '',
        });
        dirty.current = false;
        setStatus('saved');
        setSavedAt(saved.updatedAt);
        if (body.weightKg != null || body.bodyFatPct != null) {
          await saveBodyMetric({
            date,
            weightKg: body.weightKg ?? null,
            bodyFatPct: body.bodyFatPct ?? null,
          });
        }
        if (opts.final) onFinalized?.();
        return saved;
      } catch (err) {
        console.error('[wizard] 保存失败', err);
        setStatus('error');
        toast('保存失败，请检查浏览器存储空间', 'error');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [date, draft, onFinalized, saveBodyMetric, saveDailyLog, step.key, toast],
  );

  // 防抖自动保存
  useEffect(() => {
    if (!started || !dirty.current) return;
    const timer = setTimeout(() => void persist(), 700);
    return () => clearTimeout(timer);
  }, [draft, persist, started]);

  // 离开页面前尽力保存
  useEffect(() => {
    const onLeave = () => {
      if (started && dirty.current) void persist();
    };
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
  }, [persist, started]);

  const markStepDone = useCallback(
    (key: StepKey) =>
      patch((prev) => ({
        ...prev,
        completedSteps: [...new Set([...(prev.completedSteps ?? []), key])],
      })),
    [patch],
  );

  const goNext = useCallback(async () => {
    markStepDone(step.key);
    await persist();
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [markStepDone, persist, step.key]);

  const goPrev = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const skip = useCallback(async () => {
    await persist();
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [persist]);

  const finalize = useCallback(async () => {
    const saved = await persist({ final: true });
    if (saved) {
      // 归档后切到「已保存」视图，用户还可以点「编辑今日总结」继续修改
      setDraft((prev) => ({ ...prev, status: 'final', finalizedAt: saved.finalizedAt }));
      setStarted(false);
      setEditingFinal(false);
      toast('今日总结已保存归档', 'success');
    }
  }, [persist, toast]);

  /* --------------------------- 未开始：入口卡片 --------------------------- */

  const isFinal = draft.status === 'final';
  if (!started && !editingFinal && isFinal) {
    return (
      <div>
        <div data-testid="summary-final-card">
        <Card>
          <div className="row-between">
            <div>
              <div className="small muted">今日总结已保存</div>
              <div className="strong" style={{ fontSize: 17, marginTop: 2 }}>
                {formatDateCN(date)}
              </div>
            </div>
            <Chip tone="green">
              <IconCheck width={13} height={13} /> 已归档
            </Chip>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            保存在本机，可随时回来查看或修改；同一天不会产生重复记录。
          </div>
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <Button block onClick={() => setEditingFinal(true)} data-testid="summary-edit">
              编辑今日总结
            </Button>
            <Button block onClick={onOpenAdvanced}>
              完整表单
            </Button>
          </div>
        </Card>
        </div>
        <StepReviewPanel draft={draft} daySummaries={daySummaries} />
      </div>
    );
  }

  if (!started && !editingFinal) {
    return (
      <div>
        <Card className="page-enter">
          <div className="strong" style={{ fontSize: 18 }}>
            今天还没有填写今日总结
          </div>
          <div className="small muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
            一共 {STEPS.length} 步，每次只问一件事：训练 → 手表数据 → 睡眠 → 强度与感受 → 补剂 → 补充 → 确认。
            每一步都可以「暂时跳过」，随时退出也不会丢。
          </div>
          <Button
            block
            size="xl"
            variant="primary"
            style={{ marginTop: 14 }}
            data-testid="summary-start"
            onClick={() => {
              setStarted(true);
              setStatus('dirty');
              dirty.current = true;
            }}
          >
            开始今日总结
          </Button>
          {log?.status === 'draft' && (
            <Button block size="lg" style={{ marginTop: 10 }} onClick={() => setStarted(true)}>
              继续上次进度
            </Button>
          )}
        </Card>
      </div>
    );
  }

  /* ------------------------------- 步骤渲染 ------------------------------- */

  return (
    <div>
      <Card>
        <div className="wizard-head">
          <div className="wizard-step-dots">
            {STEPS.map((s, i) => (
              <i
                key={s.key}
                className={
                  i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''
                }
              />
            ))}
          </div>
          <span className="tiny muted nowrap" data-testid="wizard-progress">
            第 {stepIndex + 1} / {STEPS.length} 步
          </span>
        </div>
        <div className="row-between">
          <span className="tiny muted" data-testid="wizard-save-status">
            {statusText(status, savedAt)}
          </span>
          <button className="tiny" style={{ color: 'var(--accent)' }} data-testid="summary-advanced" onClick={onOpenAdvanced}>
            完整表单
          </button>
        </div>
        <div className="wizard-title">
          {step.emoji} {step.title}
        </div>
        <div className="wizard-hint">{step.hint}</div>

        {step.key === 'training' && (
          <StepTraining
            date={date}
            draft={draft}
            daySummaries={daySummaries}
            patchTraining={patchTraining}
            onDirty={() => {
              dirty.current = true;
              setStatus('dirty');
            }}
            onUseSummary={(s) =>
              patchTraining({
                restDay: false,
                kind: s.kind,
                items: draft.training?.items || s.planTitle,
                exercises: draft.training?.exercises || s.completedExercises.join('、'),
                durationMin:
                  draft.training?.durationMin ?? Math.round(s.totalDurationSec / 60),
                sessionCount: draft.training?.sessionCount ?? 1,
                sessionDurationsMin:
                  draft.training?.sessionDurationsMin?.length
                    ? draft.training.sessionDurationsMin
                    : [Math.round(s.totalDurationSec / 60)],
                rpe: draft.training?.rpe ?? s.rpe ?? null,
                completionPct:
                  draft.training?.completionPct ?? Math.round(s.completionRate * 100),
                volumeKg: draft.training?.volumeKg ?? s.totalVolumeKg,
                painSites: draft.training?.painSites?.length
                  ? draft.training.painSites
                  : (s.painSites ?? []),
              })
            }
          />
        )}

        {step.key === 'watch' && (
          <ScreenshotStep
            date={date}
            kind="watch"
            watch={draft.watch}
            sleep={draft.sleep}
            onWatchChange={(v) => patch((prev) => ({ ...prev, watch: { ...prev.watch, ...v } }))}
            onSleepChange={(v) => patch((prev) => ({ ...prev, sleep: { ...prev.sleep, ...v } }))}
            onDirty={() => {
              dirty.current = true;
              setStatus('dirty');
            }}
          />
        )}

        {step.key === 'sleep' && (
          <ScreenshotStep
            date={date}
            kind="sleep"
            watch={draft.watch}
            sleep={draft.sleep}
            onWatchChange={(v) => patch((prev) => ({ ...prev, watch: { ...prev.watch, ...v } }))}
            onSleepChange={(v) => patch((prev) => ({ ...prev, sleep: { ...prev.sleep, ...v } }))}
            onDirty={() => {
              dirty.current = true;
              setStatus('dirty');
            }}
          />
        )}

        {step.key === 'intensity' && (
          <StepIntensity
            draft={draft}
            onTraining={patchTraining}
            onBody={(v) => patch((prev) => ({ ...prev, body: { ...prev.body, ...v } }))}
          />
        )}

        {step.key === 'supplements' && (
          <StepSupplements
            draft={draft}
            onPatch={patchSupplements}
            onNoSupplements={(value) =>
              patch((prev) => ({
                ...prev,
                noSupplements: value,
                supplementsList: value ? [] : prev.supplementsList,
              }))
            }
            onListChange={(list: SupplementEntry[]) =>
              patch((prev) => ({ ...prev, supplementsList: list }))
            }
          />
        )}

        {step.key === 'extra' && (
          <StepExtra draft={draft} patchMeals={patchMeals} onNote={(v) => patch((prev) => ({ ...prev, freeNote: v }))} />
        )}

        {step.key === 'review' && <StepReviewPanel draft={draft} daySummaries={daySummaries} />}

        {status === 'error' && (
          <div className="chip red" style={{ marginTop: 10, whiteSpace: 'normal' }}>
            保存失败：内容还在页面上，请检查网络/存储空间后重试
          </div>
        )}

        <div className="wizard-nav">
          <Button
            block
            size="lg"
            disabled={stepIndex === 0}
            data-testid="wizard-prev"
            onClick={goPrev}
          >
            上一步
          </Button>
          {step.key === 'review' ? (
            <Button
              block
              size="lg"
              variant="primary"
              disabled={saving}
              data-testid="wizard-save"
              onClick={() => void finalize()}
            >
              {saving ? '保存中…' : '保存今日总结'}
            </Button>
          ) : (
            <Button
              block
              size="lg"
              variant="primary"
              disabled={saving}
              data-testid="wizard-next"
              onClick={() => void goNext()}
            >
              下一步
            </Button>
          )}
        </div>
        {step.key !== 'review' && (
          <Button
            block
            variant="plain"
            style={{ marginTop: 8 }}
            data-testid="wizard-skip"
            onClick={() => void skip()}
          >
            暂时跳过这一步
          </Button>
        )}
        <div className="tiny muted center" style={{ marginTop: 8 }}>
          还有 {STEPS.length - stepIndex - 1} 步 · 随时退出都会保留进度
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ 各步骤组件 ------------------------------ */

function StepTraining({
  date,
  draft,
  daySummaries,
  patchTraining,
  onUseSummary,
  onDirty,
}: {
  date: ISODate;
  draft: DailyLog;
  daySummaries: WorkoutSummary[];
  patchTraining: (v: Partial<TrainingSection>) => void;
  onUseSummary: (s: WorkoutSummary) => void;
  onDirty: () => void;
}) {
  const training = draft.training ?? {};
  const rest = training.restDay === true;
  const [more, setMore] = useState(false);

  return (
    <div>
      {daySummaries.length > 0 && (
        <div className="col" style={{ gap: 8, marginBottom: 12 }}>
          {daySummaries.map((s) => (
            <div key={s.id} className="card flat" style={{ margin: 0, padding: 12 }}>
              <div className="row-between">
                <span className="strong">
                  {SESSION_KIND_LABEL[s.kind]} · {s.planTitle}
                </span>
                <Chip tone="green">今天已完成</Chip>
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {formatDurationCN(s.totalDurationSec)} · {s.totalSets} 组 ·{' '}
                {s.completedExercises.length} 个动作
                {s.completedExercises.length ? `（${s.completedExercises.slice(0, 3).join('、')}…）` : ''}
              </div>
              <Button
                size="sm"
                style={{ marginTop: 8 }}
                data-testid="wizard-use-summary"
                onClick={() => onUseSummary(s)}
              >
                使用这条训练记录
              </Button>
            </div>
          ))}
        </div>
      )}

      {rest ? (
        <div className="chip orange" style={{ whiteSpace: 'normal', marginBottom: 10 }}>
          已标记为休息日（今天未训练），后续步骤仍可继续记录睡眠、身体与补剂。
        </div>
      ) : (
        <>
          <TrainingSessionsCard
            date={date}
            training={training}
            onChange={patchTraining}
            onDirty={onDirty}
          />
          <button
            className="link"
            style={{ marginTop: 12 }}
            data-testid="wizard-training-more"
            onClick={() => setMore((v) => !v)}
          >
            {more
              ? '收起全天补充'
              : '全天补充（可选）：概述 / 完成度 / 跑步距离 / 配速 / 比赛表现 / 疼痛'}
          </button>
          {more && (
          <div>
          <Field label="训练项目">
            <TextInput
              value={training.items ?? ''}
              onChange={(v) => patchTraining({ items: v })}
              placeholder="例如：下肢力量 + 爆发力"
              testId="wizard-training-items"
            />
          </Field>
          <div style={{ marginTop: 10 }}>
            <Field label="训练内容（动作 / 组数 / 次数 / 重量）">
              <TextArea
                value={training.exercises ?? ''}
                onChange={(v) => patchTraining({ exercises: v })}
                rows={3}
                placeholder="例如：杠铃深蹲 4组×5次 90kg"
                testId="wizard-training-exercises"
              />
            </Field>
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="grow">
              <Field label="训练次数">
                <NumberInput
                  value={training.sessionCount ?? null}
                  dec={0}
                  onChange={(v) => patchTraining({ sessionCount: v })}
                  placeholder="1"
                  testId="wizard-training-count"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="每次时长（分钟，逗号分隔）">
                <TextInput
                  value={(training.sessionDurationsMin ?? []).join(', ')}
                  onChange={(v) =>
                    patchTraining({
                      sessionDurationsMin: v
                        .split(/[,，\s]+/)
                        .map((x) => Number(x))
                        .filter((n) => Number.isFinite(n) && n > 0),
                    })
                  }
                  placeholder="60"
                  testId="wizard-training-durations"
                />
              </Field>
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="grow">
              <Field label="训练类型">
                <Select<SessionKind | ''>
                  value={(training.kind ?? '') as SessionKind | ''}
                  onChange={(v) => patchTraining({ kind: (v || null) as SessionKind | null })}
                  options={[
                    { value: '', label: '未指定' },
                    ...(Object.keys(SESSION_KIND_LABEL) as SessionKind[]).map((k) => ({
                      value: k,
                      label: SESSION_KIND_LABEL[k],
                    })),
                  ]}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="训练容量（kg，可选）">
                <NumberInput
                  value={training.volumeKg ?? null}
                  dec={0}
                  onChange={(v) => patchTraining({ volumeKg: v })}
                />
              </Field>
            </div>
          </div>
          </div>
          )}
        </>
      )}

      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <Button
          block
          variant={rest ? 'primary' : 'default'}
          data-testid="wizard-rest-day"
          onClick={() => patchTraining({ restDay: !rest, items: rest ? '' : '休息日' })}
        >
          {rest ? '改为有训练' : '今天未训练（休息日）'}
        </Button>
      </div>
    </div>
  );
}

function StepIntensity({
  draft,
  onTraining,
  onBody,
}: {
  draft: DailyLog;
  onTraining: (v: Partial<TrainingSection>) => void;
  onBody: (v: Partial<NonNullable<DailyLog['body']>>) => void;
}) {
  const rpe = draft.training?.rpe ?? null;
  const body = draft.body ?? {};
  const fatigue10 = body.fatigue10 ?? null;
  const scale = (
    label: string,
    value: number | null | undefined,
    key: 'fatigue' | 'soreness' | 'mood' | 'recovery',
    labels?: string[],
  ) => (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div className="scale-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`scale-dot ${value === n ? 'active' : ''}`}
            data-testid={`wizard-${key}-${n}`}
            onClick={() => onBody({ [key]: value === n ? null : n })}
          >
            {labels?.[n - 1] ?? n}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="small muted" style={{ marginBottom: 6 }}>
        今天的训练强度 RPE（0 = 完全轻松，10 = 极限）
      </div>
      <div className="rpe-scale" data-testid="wizard-rpe">
        {Array.from({ length: 11 }).map((_, n) => (
          <button
            key={n}
            className={rpe === n ? 'active' : ''}
            data-testid={`wizard-rpe-${n}`}
            onClick={() => onTraining({ rpe: rpe === n ? null : n })}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        {rpe == null
          ? '未选择'
          : rpe <= 4
            ? `${rpe} · 轻松`
            : rpe <= 6
              ? `${rpe} · 中等`
              : rpe <= 8
                ? `${rpe} · 偏硬`
                : `${rpe} · 接近极限`}
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>
          疲劳程度（0~10，报告里常用十分制；和下面的 1~5 分制并存）
        </div>
        <div className="rpe-scale" data-testid="wizard-fatigue10">
          {Array.from({ length: 11 }).map((_, n) => (
            <button
              key={n}
              className={fatigue10 === n ? 'active' : ''}
              data-testid={`wizard-fatigue10-${n}`}
              onClick={() => onBody({ fatigue10: fatigue10 === n ? null : n })}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          {fatigue10 == null ? '未填写（可跳过）' : `当前：${fatigue10} / 10`}
        </div>
      </div>

      {scale('疲劳程度', body.fatigue, 'fatigue', ['很轻', '轻', '一般', '累', '很累'])}
      {scale('肌肉酸痛', body.soreness, 'soreness', ['无', '轻微', '一般', '明显', '严重'])}
      {scale('恢复情况', body.recovery, 'recovery', ['很差', '较差', '一般', '不错', '很好'])}

      <div style={{ marginTop: 12 }}>
        <Field label="酸痛 / 不适部位（可不填）">
          <TextArea
            value={body.injuryPain ?? ''}
            onChange={(v) => onBody({ injuryPain: v })}
            rows={2}
            placeholder="例如：右膝在深蹲最后两组有轻微不适"
            testId="wizard-injury"
          />
        </Field>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="grow">
          <Field label="今日体重（kg，可选）">
            <NumberInput
              value={body.weightKg ?? null}
              onChange={(v) => onBody({ weightKg: v })}
              testId="wizard-weight"
            />
          </Field>
        </div>
        <div className="grow">
          <Field label="体脂率（%，可选）">
            <NumberInput
              value={body.bodyFatPct ?? null}
              onChange={(v) => onBody({ bodyFatPct: v })}
              testId="wizard-bodyfat"
            />
          </Field>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="今日整体感受（可不填）">
          <TextArea
            value={body.overall ?? ''}
            onChange={(v) => onBody({ overall: v })}
            rows={2}
            testId="wizard-overall"
          />
        </Field>
      </div>
    </div>
  );
}

function StepSupplements({
  draft,
  onPatch,
  onNoSupplements,
  onListChange,
}: {
  draft: DailyLog;
  onPatch: (v: Partial<NonNullable<DailyLog['supplements']>>) => void;
  onNoSupplements: (v: boolean) => void;
  onListChange: (list: SupplementEntry[]) => void;
}) {
  const supp = draft.supplements ?? {};
  const list = draft.supplementsList ?? [];
  const none = draft.noSupplements === true;

  function addPreset(name: string) {
    if (list.some((s) => s.name === name)) return;
    onListChange([
      ...list,
      {
        id: uid('sup'),
        name,
        amount: name === '蛋白粉' ? 30 : name === '肌酸' ? 5 : null,
        unit: name === '蛋白粉' ? 'g' : name === '肌酸' ? 'g' : '',
      },
    ]);
  }

  return (
    <div>
      <Button
        block
        size="lg"
        variant={none ? 'primary' : 'default'}
        data-testid="wizard-no-supplements"
        onClick={() => onNoSupplements(!none)}
      >
        {none ? '✓ 今天没吃补剂' : '今天没吃补剂'}
      </Button>

      {!none && (
        <>
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="grow">
              <Field label="蛋白粉（勺）">
                <NumberInput
                  value={supp.proteinScoops ?? null}
                  dec={0}
                  onChange={(v) => onPatch({ proteinScoops: v })}
                  testId="wizard-protein-scoops"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="蛋白质（g）">
                <NumberInput
                  value={supp.proteinG ?? null}
                  dec={0}
                  onChange={(v) => onPatch({ proteinG: v })}
                  testId="wizard-protein-g"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="肌酸（g）">
                <NumberInput
                  value={supp.creatineG ?? null}
                  dec={0}
                  onChange={(v) => onPatch({ creatineG: v })}
                  testId="wizard-creatine"
                />
              </Field>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              常用补剂快捷添加
            </div>
            <div className="wrap" style={{ gap: 6 }}>
              {PRESET_SUPPLEMENTS.map((name) => (
                <button
                  key={name}
                  className={`chip ${list.some((s) => s.name === name) ? 'accent' : ''}`}
                  onClick={() => addPreset(name)}
                >
                  <IconPlus width={12} height={12} /> {name}
                </button>
              ))}
            </div>
          </div>

          {list.length > 0 && (
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              {list.map((item) => (
                <div key={item.id} className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <TextInput
                      value={item.name}
                      onChange={(v) =>
                        onListChange(list.map((s) => (s.id === item.id ? { ...s, name: v } : s)))
                      }
                    />
                  </div>
                  <div style={{ width: 90 }}>
                    <NumberInput
                      value={item.amount ?? null}
                      onChange={(v) =>
                        onListChange(list.map((s) => (s.id === item.id ? { ...s, amount: v } : s)))
                      }
                    />
                  </div>
                  <div style={{ width: 70 }}>
                    <TextInput
                      value={item.unit ?? ''}
                      onChange={(v) =>
                        onListChange(list.map((s) => (s.id === item.id ? { ...s, unit: v } : s)))
                      }
                      placeholder="g"
                    />
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={`删除 ${item.name}`}
                    onClick={() => onListChange(list.filter((s) => s.id !== item.id))}
                  >
                    <IconTrash width={18} height={18} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            block
            style={{ marginTop: 10 }}
            data-testid="wizard-add-supplement"
            onClick={() =>
              onListChange([...list, { id: uid('sup'), name: '', amount: null, unit: 'g' }])
            }
          >
            <IconPlus width={16} height={16} style={{ marginRight: 6 }} />
            添加自定义补剂
          </Button>

          <div style={{ marginTop: 10 }}>
            <Field label="咖啡因（mg，可选）">
              <NumberInput
                value={supp.caffeineMg ?? null}
                dec={0}
                onChange={(v) => onPatch({ caffeineMg: v })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="其他补剂备注（可选）">
              <TextInput
                value={supp.others ?? ''}
                onChange={(v) => onPatch({ others: v })}
                placeholder="例如：睡前镁 200mg"
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function StepExtra({
  draft,
  patchMeals,
  onNote,
}: {
  draft: DailyLog;
  patchMeals: (v: Partial<MealLog>) => void;
  onNote: (v: string) => void;
}) {
  const meals = draft.meals ?? {};
  return (
    <div>
      <div className="form-row">
        <div className="grow">
          <Field label="早餐">
            <TextInput value={meals.breakfast ?? ''} onChange={(v) => patchMeals({ breakfast: v })} placeholder="燕麦 + 鸡蛋" />
          </Field>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="grow">
          <Field label="午餐">
            <TextInput value={meals.lunch ?? ''} onChange={(v) => patchMeals({ lunch: v })} />
          </Field>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="grow">
          <Field label="晚餐">
            <TextInput value={meals.dinner ?? ''} onChange={(v) => patchMeals({ dinner: v })} />
          </Field>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 10 }}>
        <div className="grow">
          <Field label="加餐">
            <TextInput value={meals.snack ?? ''} onChange={(v) => patchMeals({ snack: v })} />
          </Field>
        </div>
        <div className="grow">
          <Field label="饮水（ml）">
            <NumberInput value={meals.waterMl ?? null} dec={0} onChange={(v) => patchMeals({ waterMl: v })} />
          </Field>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="当日自由记录（比赛、生活、身体异常等）">
          <TextArea
            value={draft.freeNote ?? ''}
            onChange={onNote}
            rows={4}
            placeholder="想告诉 ChatGPT 的任何内容"
            testId="wizard-free-note"
          />
        </Field>
      </div>
    </div>
  );
}

function StepReviewPanel({
  draft,
  daySummaries,
}: {
  draft: DailyLog;
  daySummaries: WorkoutSummary[];
}) {
  const training = draft.training ?? {};
  const watch = draft.watch ?? {};
  const sleep = draft.sleep ?? {};
  const body = draft.body ?? {};
  const supp = draft.supplements ?? {};
  const line = (label: string, value: React.ReactNode) => (
    <div className="row-between" style={{ marginTop: 2 }}>
      <span className="tiny muted">{label}</span>
      <span className="small" style={{ textAlign: 'right', maxWidth: '62%' }}>
        {value ?? '未记录'}
      </span>
    </div>
  );

  return (
    <div data-testid="wizard-review">
    <Card>
      <div className="summary-block">
        <h4>训练</h4>
        {training.restDay ? (
          <div className="small">休息日（今天未训练）</div>
        ) : (
          <>
            {line('项目', training.items || null)}
            {line('内容', training.exercises || null)}
            {line('训练次数', training.sessionCount ?? null)}
            {line(
              '每次时长',
              training.sessionDurationsMin?.length
                ? training.sessionDurationsMin.map((m) => `${m} 分钟`).join(' / ')
                : null,
            )}
            {line('RPE', training.rpe ?? null)}
            {line('容量', training.volumeKg ? `${formatNumber(training.volumeKg)} kg` : null)}
          </>
        )}
        {daySummaries.length > 0 && (
          <div className="tiny muted" style={{ marginTop: 4 }}>
            今天保存了 {daySummaries.length} 条训练记录（含组数/次数/重量明细）
          </div>
        )}
      </div>
      <div className="summary-block">
        <h4>Apple Watch</h4>
        {line('活动能量', watch.activeEnergyKcal ? `${watch.activeEnergyKcal} kcal` : null)}
        {line('运动分钟', watch.exerciseMinutes ? `${watch.exerciseMinutes} 分钟` : null)}
        {line('步数', watch.steps ?? null)}
        {line('站立', watch.standHours ? `${watch.standHours} 小时` : null)}
        {line('移动距离', watch.distanceKm ? `${formatNumber(watch.distanceKm, 2)} km` : null)}
        {line('平均 / 最高心率', watch.avgHr || watch.maxHr ? `${watch.avgHr ?? '—'} / ${watch.maxHr ?? '—'} bpm` : null)}
        {line('静息心率', watch.restingHr ? `${watch.restingHr} bpm` : null)}
        {line('HRV', watch.hrvMs ? `${watch.hrvMs} ms` : null)}
      </div>
      {(draft.training?.sessions ?? []).length > 0 && (
        <div className="summary-block" data-testid="review-sessions">
          <h4>训练场次（{(draft.training?.sessions ?? []).length}）</h4>
          {(draft.training?.sessions ?? []).map((s, i) => {
            const bits = [
              s.startTime ? `${s.startTime}` : '',
              s.name || `第 ${i + 1} 次训练`,
              s.durationMin ? `${formatNumber(s.durationMin)} 分钟` : '',
              s.watchRecorded ? 'Apple Watch 已记录' : 'Apple Watch 未记录',
              s.kcal ? `动态 ${formatNumber(s.kcal)} kcal` : '',
              s.totalKcal ? `总消耗 ${formatNumber(s.totalKcal)} kcal` : '',
              s.avgHr ? `平均心率 ${s.avgHr}` : '',
              s.distanceKm ? `${formatNumber(s.distanceKm, 2)} km` : '',
            ].filter(Boolean);
            return (
              <div key={s.id ?? i} className="tiny" style={{ lineHeight: 1.8 }}>
                · {bits.join(' · ')}
                {s.note ? <div className="muted">　内容：{s.note}</div> : null}
                {s.feel ? <div className="muted">　感受：{s.feel}</div> : null}
              </div>
            );
          })}
          <div className="tiny muted" style={{ marginTop: 4 }}>
            训练次数按卡片自动统计；全天活动能量已包含训练消耗，报告里不会重复相加。
          </div>
        </div>
      )}
      <div className="summary-block">
        <h4>睡眠</h4>
        {line(
          '总睡眠',
          sleep.totalHours ? `${sleepDurationText(sleep.totalHours)}（${formatNumber(sleep.totalHours)} 小时）` : null,
        )}
        {line('入睡 / 起床', sleep.sleepTime || sleep.wakeTime ? `${sleep.sleepTime ?? '—'} / ${sleep.wakeTime ?? '—'}` : null)}
        {line('深度 / 核心 / REM', [sleep.deepHours, sleep.coreHours, sleep.remHours].some((v) => v != null)
          ? `${formatNumber(sleep.deepHours ?? 0)} / ${formatNumber(sleep.coreHours ?? 0)} / ${formatNumber(sleep.remHours ?? 0)} 小时`
          : null)}
        {line('主观质量', sleep.quality ? `${sleep.quality} / 5` : null)}
      </div>
      <div className="summary-block">
        <h4>强度与身体</h4>
        {line('疲劳', body.fatigue ? `${body.fatigue} / 5` : null)}
        {line('疲劳（0~10）', body.fatigue10 != null ? `${formatNumber(body.fatigue10)} / 10` : null)}
        {line('酸痛', body.soreness ? `${body.soreness} / 5` : null)}
        {line('恢复', body.recovery ? `${body.recovery} / 5` : null)}
        {line('体重 / 体脂', body.weightKg != null || body.bodyFatPct != null
          ? `${body.weightKg != null ? `${formatNumber(body.weightKg)} kg` : '—'} / ${
              body.bodyFatPct != null ? `${formatNumber(body.bodyFatPct)} %` : '—'
            }`
          : null)}
        {line('不适', body.injuryPain || null)}
        {line('整体感受', body.overall || null)}
      </div>
      <div className="summary-block">
        <h4>补剂</h4>
        {draft.noSupplements ? (
          <div className="small">今天没吃补剂</div>
        ) : (
          <>
            {line('蛋白粉', supp.proteinScoops ? `${supp.proteinScoops} 勺` : supp.proteinG ? `${supp.proteinG} g` : null)}
            {line('肌酸', supp.creatineG ? `${supp.creatineG} g` : null)}
            {line(
              '其他',
              (draft.supplementsList ?? []).length
                ? (draft.supplementsList ?? [])
                    .map((s) => `${s.name}${s.amount ? ` ${s.amount}${s.unit ?? ''}` : ''}`)
                    .join('、')
                : supp.others || null,
            )}
            {line('咖啡因', supp.caffeineMg ? `${supp.caffeineMg} mg` : null)}
          </>
        )}
      </div>
      <div className="summary-block">
        <h4>其他</h4>
        {line('饮食', [draft.meals?.breakfast, draft.meals?.lunch, draft.meals?.dinner].filter(Boolean).join(' / ') || null)}
        {line('饮水', draft.meals?.waterMl ? `${draft.meals.waterMl} ml` : null)}
        {line('自由记录', draft.freeNote || null)}
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        没有记录的项目会显示「未记录」，导出的报告里也会如实标注，不会自动猜测。
      </div>
    </Card>
    </div>
  );
}
