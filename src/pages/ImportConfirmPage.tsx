/**
 * 导入确认页：把 PDF 解析结果展示成「可编辑的草稿」，
 * 用户确认后才写入 IndexedDB，绝不覆盖已有数据。
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Bar,
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  Field,
  ListRow,
  NumberInput,
  SectionTitle,
  Select,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { IconCheck, IconImport, IconMinus, IconTrash } from '../components/icons';
import { useAppData } from '../state/AppData';
import {
  SESSION_KIND_LABEL,
  type BodyMetric,
  type ExerciseItem,
  type PlanDraft,
  type SessionKind,
  type SummaryDraft,
  type TrainingPlan,
} from '../types';
import { formatDateCN, formatNumber, toISODate, uid } from '../lib/format';
import { normalizeText, parseDurationSec } from '../lib/pdf/text';
import {
  buildDraft,
  bodyEntriesToMetrics,
  clearDraftFromSession,
  diffDailyLog,
  findDuplicateImport,
  readDraftFromSession,
  type AnyDraft,
  type BodyDraft,
  type WeeklyDraft,
} from '../lib/pdf';
import './import.css';

const KIND_OPTIONS = (Object.keys(SESSION_KIND_LABEL) as SessionKind[]).map((k) => ({
  value: k,
  label: SESSION_KIND_LABEL[k],
}));

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="confidence">
      <span className="tiny muted nowrap">解析可信度</span>
      <Bar value={value} tone={value > 0.6 ? 'green' : undefined} />
      <span className="tiny muted nowrap">{pct}%</span>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="warn-box">
      <div className="strong small">需要核对</div>
      <ul>
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- 计划确认 */

interface DurationInputResult {
  durationSec: number | null;
  normalized: string;
  error: string | null;
}

function isTimedTarget(target: PlanDraft['exercises'][number]['target']): boolean {
  return target.durationSec != null || target.durationText != null;
}

function parseDurationEditorValue(value: string, perSide: boolean): DurationInputResult {
  const text = normalizeText(value).trim();
  const suffix = perSide ? '/侧' : '';
  if (!text) {
    return { durationSec: null, normalized: '', error: '时长不能为空，请填写秒数或时间范围。' };
  }

  const single = text.match(/^(\d+(?:\.\d+)?)$/);
  if (single) {
    const sec = Number(single[1]);
    if (sec > 0) {
      return { durationSec: sec, normalized: `${single[1]}秒${suffix}`, error: null };
    }
  }

  const bareRange = text.match(/^(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)$/);
  if (bareRange) {
    const min = Number(bareRange[1]);
    const max = Number(bareRange[2]);
    if (min > 0 && max >= min) {
      return {
        durationSec: max,
        normalized: `${bareRange[1]}-${bareRange[2]}秒${suffix}`,
        error: null,
      };
    }
  }

  const sec = parseDurationSec(text);
  if (sec != null && sec > 0 && /(?:秒|分钟|分|min|s\b)/i.test(text)) {
    const base = text.replace(/\s*\/\s*侧\s*$/, '').trim();
    const normalized = perSide && !/\/侧$/.test(base) ? `${base}/侧` : text;
    return { durationSec: sec, normalized, error: null };
  }

  return {
    durationSec: null,
    normalized: text,
    error: '请输入秒数、分钟数或时间范围，例如 30、30秒或 25-35秒/侧。不要填写“次”。',
  };
}

function PlanConfirm({
  draft: initial,
  savedRecord,
}: {
  draft: PlanDraft;
  savedRecord?: { planId?: string | null } | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const { createPlanFromDraft, markPdfImportSaved, savePlan } = useAppData();
  const toast = useToast();
  const navigate = useNavigate();

  const patch = (p: Partial<PlanDraft>) => setDraft((prev) => ({ ...prev, ...p }));
  const patchEx = (id: string, p: Partial<ExerciseItem>) =>
    setDraft((prev) => ({
      ...prev,
      exercises: prev.exercises.map((e) => (e.id === id ? { ...e, ...p } : e)),
    }));

  const moveEx = (index: number, dir: -1 | 1) => {
    const next = [...draft.exercises];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ exercises: next.map((e, i) => ({ ...e, order: i })) });
  };

  const addEx = () =>
    patch({
      exercises: [
        ...draft.exercises,
        {
          id: uid('ex'),
          name: '',
          kind: draft.sessionKind,
          target: { sets: 3, reps: '10' },
          order: draft.exercises.length,
        },
      ],
    });

  const normalizeDurationTargets = (): PlanDraft | null => {
    let invalidIndex = -1;
    let invalidMessage = '';
    const exercises = draft.exercises.map((ex) => {
      if (!isTimedTarget(ex.target)) return ex;
      const perSide = ex.target.durationPerSide ?? ex.target.durationText?.includes('/侧') ?? false;
      const rawDuration =
        ex.target.durationText ??
        (ex.target.durationSec != null ? `${ex.target.durationSec}秒` : '');
      const parsed = parseDurationEditorValue(rawDuration, perSide);
      if (parsed.error && invalidIndex < 0) {
        invalidIndex = ex.order;
        invalidMessage = parsed.error;
      }
      return {
        ...ex,
        target: {
          ...ex.target,
          durationSec: parsed.durationSec,
          durationText: parsed.normalized,
          reps: null,
        },
      };
    });
    if (invalidIndex >= 0) {
      toast(`第 ${invalidIndex + 1} 个动作的时长无效：${invalidMessage}`, 'error');
      return null;
    }
    return { ...draft, exercises };
  };

  const save = async (copySaved = false) => {
    if (savedRecord && !copySaved) {
      toast('这是上次已保存的导入结果，请点击「复制为新计划」明确创建副本', 'error');
      return;
    }
    if (draft.exercises.length === 0) {
      toast('至少需要一个动作，或改用「手动新建计划」', 'error');
      return;
    }
    const normalized = normalizeDurationTargets();
    if (!normalized) return;
    setSaving(true);
    try {
      const plan: TrainingPlan = await createPlanFromDraft({
        ...normalized,
        title: normalized.title.trim() || '导入的训练计划',
        exercises: normalized.exercises.map((e, i) => ({ ...e, order: i })),
      });
      if (!copySaved) {
        await markPdfImportSaved(draft.importId, { planId: plan.id, kind: 'plan' });
      }
      clearDraftFromSession();
      toast(copySaved ? '已复制为新的训练计划' : '已保存为新的训练计划，可以开始训练了', 'success');
      navigate('/');
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  /** 另存一份：与确认保存、旧结果复制共用同一套时长校验与归一化。 */
  const saveAsTemplate = async () => {
    const normalized = normalizeDurationTargets();
    if (!normalized) return;
    setSaving(true);
    try {
      const plan = await createPlanFromDraft({
        ...normalized,
        title: `${normalized.title}（模板）`,
      });
      await savePlan(plan);
      toast('已另存一份到训练计划列表', 'success');
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
      <Page
      title="导入确认"
      sub={`${draft.fileName} · ${draft.exercises.length} 个动作`}
      back
      right={
        <button className="icon-btn" onClick={() => setAskDiscard(true)} aria-label="放弃导入">
          <IconTrash width={20} height={20} />
        </button>
      }
    >
      {savedRecord && (
        <Card>
          <div className="strong" style={{ marginBottom: 6 }}>这是上次已保存的导入结果</div>
          <div className="tiny muted" style={{ lineHeight: 1.7 }}>
            为避免重复计划，再次进入这里不会自动保存原记录。只有点击「复制为新计划」时才会创建一份新的训练计划。
          </div>
        </Card>
      )}

      <Card>
        <div className="import-meta">
          <Chip tone="accent">健身计划</Chip>
          <Chip>{draft.warmup.length} 项热身</Chip>
          <Chip>{draft.exercises.length} 个动作</Chip>
        </div>
        <ConfidenceBar value={draft.confidence} />
        <Warnings items={draft.warnings} />
        <div className="col" style={{ gap: 12, marginTop: 10 }}>
          <Field label="计划名称">
            <TextInput value={draft.title} onChange={(v) => patch({ title: v })} testId="import-title" />
          </Field>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="grow">
              <Field label="日期">
                <input
                  className="input"
                  type="date"
                  value={draft.date ?? toISODate()}
                  data-testid="plan-date"
                  onChange={(e) => patch({ date: e.target.value })}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="类型">
                <Select
                  value={draft.sessionKind}
                  onChange={(v) => patch({ sessionKind: v })}
                  options={KIND_OPTIONS}
                />
              </Field>
            </div>
          </div>
          <Field label="预计训练时间（分钟）">
            <NumberInput
              value={draft.estimatedMinutes}
              onChange={(v) => patch({ estimatedMinutes: v })}
              dec={0}
              placeholder="如 75"
              testId="plan-minutes"
            />
          </Field>
        </div>
      </Card>

      <SectionTitle
        action="添加热身"
        onAction={() =>
          patch({ warmup: [...draft.warmup, { name: '新的热身', detail: '', durationSec: 300 }] })
        }
      >
        热身
      </SectionTitle>
      {draft.warmup.length === 0 ? (
        <Card flat>
          <p className="small muted" style={{ margin: 0 }}>
            没有识别到热身内容，可以点击右上角「添加热身」。
          </p>
        </Card>
      ) : (
        <div className="list">
          {draft.warmup.map((w, i) => (
            <div className="list-row" key={`${w.name}-${i}`}>
              <div className="grow col" style={{ gap: 6 }}>
                <TextInput
                  value={w.name}
                  onChange={(v) =>
                    patch({ warmup: draft.warmup.map((x, j) => (j === i ? { ...x, name: v } : x)) })
                  }
                  placeholder="热身内容"
                />
                <TextInput
                  value={w.detail ?? ''}
                  onChange={(v) =>
                    patch({ warmup: draft.warmup.map((x, j) => (j === i ? { ...x, detail: v } : x)) })
                  }
                  placeholder="说明（可选）"
                />
              </div>
              <button
                className="icon-btn"
                aria-label="删除热身"
                onClick={() => patch({ warmup: draft.warmup.filter((_, j) => j !== i) })}
              >
                <IconMinus width={18} height={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <SectionTitle action="添加动作" onAction={addEx}>
        训练动作
      </SectionTitle>
      {draft.exercises.map((ex, i) => (
        <div className="exercise-card" key={ex.id} data-testid="exercise-card">
          <div className="ex-head">
            <span className="chip accent">{i + 1}</span>
            <div className="grow">
              <TextInput
                value={ex.name}
                onChange={(v) => patchEx(ex.id, { name: v })}
                placeholder="动作名称"
                testId={`ex-name-${i}`}
              />
            </div>
            <div className="ex-actions">
              <button aria-label="上移" onClick={() => moveEx(i, -1)}>
                ↑
              </button>
              <button aria-label="下移" onClick={() => moveEx(i, 1)}>
                ↓
              </button>
              <button
                aria-label="删除动作"
                onClick={() => patch({ exercises: draft.exercises.filter((e) => e.id !== ex.id) })}
              >
                <IconTrash width={17} height={17} />
              </button>
            </div>
          </div>
          <div className="exercise-grid">
            <Field label="组数">
              <NumberInput
                value={ex.target.sets ?? null}
                dec={0}
                testId={`ex-sets-${i}`}
                onChange={(v) => patchEx(ex.id, { target: { ...ex.target, sets: v, setsText: null } })}
              />
              {ex.target.setsText && (
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  原文为 {ex.target.setsText} 组，训练流程按上限 {ex.target.sets ?? '-'} 组保存
                </div>
              )}
            </Field>
            {isTimedTarget(ex.target) ? (
              <Field
                  label={
                    (ex.target.durationPerSide ?? ex.target.durationText?.includes('/侧'))
                      ? '时长（每侧）'
                      : '时长'
                  }
                >
                <TextInput
                  value={
                    ex.target.durationText ??
                    (ex.target.durationSec != null ? `${ex.target.durationSec}秒` : '')
                  }
                  testId={`ex-duration-${i}`}
                  onChange={(v) => {
                    const perSide =
                      ex.target.durationPerSide ||
                      /\/\s*侧/.test(v) ||
                      Boolean(ex.target.durationText?.includes('/侧'));
                    const parsed = parseDurationEditorValue(v, perSide);
                    patchEx(ex.id, {
                      target: {
                        ...ex.target,
                        durationText: v,
                        durationSec: parsed.durationSec,
                        durationPerSide: perSide,
                        reps: null,
                      },
                    });
                  }}
                  placeholder="25-35秒/侧"
                />
                {(() => {
                  const perSide = ex.target.durationPerSide ?? ex.target.durationText?.includes('/侧') ?? false;
                  const rawDuration =
                    ex.target.durationText ??
                    (ex.target.durationSec != null ? `${ex.target.durationSec}秒` : '');
                  const parsed = parseDurationEditorValue(rawDuration, perSide);
                  return parsed.error ? (
                    <div className="tiny" style={{ color: '#c62828', marginTop: 4 }}>
                      {parsed.error}
                    </div>
                  ) : null;
                })()}
              </Field>
            ) : (
              <Field label="次数">
                <TextInput
                  value={ex.target.reps ?? ''}
                  testId={`ex-reps-${i}`}
                  onChange={(v) => patchEx(ex.id, { target: { ...ex.target, reps: v } })}
                  placeholder="8-12"
                />
              </Field>
            )}
            <Field label="重量 kg">
              <NumberInput
                value={ex.target.weightKg ?? null}
                testId={`ex-weight-${i}`}
                onChange={(v) => patchEx(ex.id, { target: { ...ex.target, weightKg: v } })}
              />
            </Field>
            <Field label="组间休息 秒">
              <NumberInput
                value={ex.target.restSec ?? null}
                dec={0}
                onChange={(v) => patchEx(ex.id, { target: { ...ex.target, restSec: v } })}
              />
            </Field>
            <Field label="RPE">
              <NumberInput
                value={ex.target.rpe ?? null}
                onChange={(v) => patchEx(ex.id, { target: { ...ex.target, rpe: v } })}
              />
            </Field>
            <Field label="类型">
              <Select
                value={ex.kind}
                onChange={(v) => patchEx(ex.id, { kind: v })}
                options={KIND_OPTIONS}
              />
            </Field>
          </div>
          <div className="col" style={{ gap: 8, marginTop: 10 }}>
            <Field label="动作要领">
              <TextArea
                rows={2}
                value={ex.cue ?? ''}
                onChange={(v) => patchEx(ex.id, { cue: v })}
                placeholder="如：下蹲到大腿与地面平行"
              />
            </Field>
            <Field label="注意事项">
              <TextArea
                rows={2}
                value={ex.notes ?? ''}
                onChange={(v) => patchEx(ex.id, { notes: v })}
                placeholder="如：全程收紧核心"
              />
            </Field>
          </div>
        </div>
      ))}

      <SectionTitle>拉伸与恢复</SectionTitle>
      <Card flat>
        <TextArea
          rows={3}
          value={draft.cooldown}
          onChange={(v) => patch({ cooldown: v })}
          placeholder="如：股四头肌、腘绳肌各 30 秒 × 2 组"
        />
      </Card>

      <SectionTitle>备注</SectionTitle>
      <Card flat>
        <TextArea rows={2} value={draft.notes} onChange={(v) => patch({ notes: v })} />
      </Card>

      <div className="sticky-actions">
        <Button block size="xl" variant="primary" disabled={saving} onClick={() => void save(savedRecord != null)}>
          <IconCheck width={20} height={20} />
          {saving ? (savedRecord ? '正在复制计划…' : '正在保存计划…') : savedRecord ? '复制为新计划' : '确认保存计划'}
        </Button>
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          {!savedRecord && (
            <Button block size="lg" onClick={() => void saveAsTemplate()} disabled={saving}>
              另存一份计划
            </Button>
          )}
          <Button block size="lg" variant="ghost" onClick={() => setAskDiscard(true)}>
            放弃
          </Button>
        </div>
      </div>

      <Confirm
        open={askDiscard}
        title="放弃这次导入？"
        message="PDF 文字已保存在本机，之后可以在「训练 → PDF 导入记录」里重新解析。"
        confirmText="放弃导入"
        danger
        onCancel={() => setAskDiscard(false)}
        onConfirm={() => {
          clearDraftFromSession();
          navigate('/train');
        }}
      />
    </Page>
  );
}

/* ------------------------------------------------------------- 总结确认 */

function SummaryConfirm({ draft: initial }: { draft: SummaryDraft }) {
  const [draft, setDraft] = useState(initial);
  const [alsoWeight, setAlsoWeight] = useState(initial.weightKg != null);
  const [saving, setSaving] = useState(false);
  const { dailyLogs, summaries, pdfImports, saveDailyLog, saveBodyMetric, markPdfImportSaved } =
    useAppData();
  const toast = useToast();
  const navigate = useNavigate();

  const record = pdfImports.find((r) => r.id === draft.importId) ?? null;
  const existing = dailyLogs.find((d) => d.date === draft.date) ?? null;
  const duplicate = useMemo(() => {
    if (!record) return null;
    const found = findDuplicateImport(pdfImports, record.fileName, record.fileSize);
    return found && found.id !== record.id ? found : null;
  }, [pdfImports, record]);

  const diff = useMemo(
    () =>
      diffDailyLog(existing, draft, {
        duplicateImport: duplicate != null,
        hasTrainingSummary: summaries.some((s) => s.date === draft.date),
      }),
    [draft, duplicate, existing, summaries],
  );

  const patch = (p: Partial<SummaryDraft>) => setDraft((prev) => ({ ...prev, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      await saveDailyLog({ ...diff.payload, date: draft.date });
      if (alsoWeight && draft.weightKg != null) {
        await saveBodyMetric({ date: draft.date, weightKg: draft.weightKg, sleepHours: draft.sleepHours ?? null });
      }
      await markPdfImportSaved(draft.importId, { dailyLogId: draft.date, kind: 'daily-summary' });
      clearDraftFromSession();
      toast('已合并到这一天的总结', 'success');
      navigate(`/summary?date=${draft.date}`);
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="确认今日总结" sub={`${draft.fileName} · ${formatDateCN(draft.date)}`} back>
      <Card>
        <div className="import-meta">
          <Chip tone="accent">今日训练总结</Chip>
          <Chip>RPE {draft.rpe ?? '—'}</Chip>
          <Chip>{draft.trainingVolumeKg ? `${formatNumber(draft.trainingVolumeKg, 0)} kg` : '无训练量'}</Chip>
        </div>
        <ConfidenceBar value={draft.confidence} />
        <Warnings items={draft.warnings} />
      </Card>

      <SectionTitle>保存前的变更预览</SectionTitle>
      <Card>
        {diff.creates.length === 0 && diff.updates.length === 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            没有需要写入的新内容。
          </p>
        )}
        {diff.creates.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div className="small strong" style={{ marginBottom: 6 }}>
              新增 {diff.creates.length} 项
            </div>
            <div className="diff-list">
              {diff.creates.map((c) => (
                <div className="diff-row new" key={c.label}>
                  <span className="k">{c.label}</span>
                  <span className="v">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {diff.updates.length > 0 && (
          <div>
            <div className="small strong" style={{ marginBottom: 6 }}>
              修改 {diff.updates.length} 项
            </div>
            <div className="diff-list">
              {diff.updates.map((u) => (
                <div className="diff-row" key={u.label}>
                  <span className="k">{u.label}</span>
                  <span className="v">
                    <span className="old">{u.from}</span>
                    <span>{u.to}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {diff.unchanged.length > 0 && (
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            保持不变：{diff.unchanged.join('、')}
          </p>
        )}
        {diff.conflicts.length > 0 && (
          <div className="warn-box" style={{ marginTop: 12, marginBottom: 0 }}>
            <ul style={{ margin: 0 }}>
              {diff.conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <SectionTitle>可编辑字段</SectionTitle>
      <Card>
        <div className="col" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="grow">
              <Field label="日期">
                <input
                  className="input"
                  type="date"
                  value={draft.date}
                  onChange={(e) => patch({ date: e.target.value })}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="体重 kg">
                <NumberInput value={draft.weightKg} onChange={(v) => patch({ weightKg: v })} />
              </Field>
            </div>
          </div>
          <Field label="训练内容">
            <TextArea rows={3} value={draft.trainingContent} onChange={(v) => patch({ trainingContent: v })} />
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <div className="grow">
              <Field label="训练量 kg">
                <NumberInput
                  value={draft.trainingVolumeKg}
                  dec={0}
                  onChange={(v) => patch({ trainingVolumeKg: v })}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="RPE">
                <NumberInput value={draft.rpe} onChange={(v) => patch({ rpe: v })} />
              </Field>
            </div>
            <div className="grow">
              <Field label="睡眠 小时">
                <NumberInput value={draft.sleepHours} onChange={(v) => patch({ sleepHours: v })} />
              </Field>
            </div>
          </div>
          <Field label="饮食">
            <TextArea rows={2} value={draft.diet} onChange={(v) => patch({ diet: v })} />
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <div className="grow">
              <Field label="蛋白粉 勺">
                <NumberInput
                  value={draft.supplements?.proteinScoops ?? null}
                  onChange={(v) => patch({ supplements: { ...draft.supplements, proteinScoops: v } })}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="肌酸 g">
                <NumberInput
                  value={draft.supplements?.creatineG ?? null}
                  onChange={(v) => patch({ supplements: { ...draft.supplements, creatineG: v } })}
                />
              </Field>
            </div>
          </div>
          <Field label="疼痛或不适">
            <TextArea rows={2} value={draft.pain} onChange={(v) => patch({ pain: v })} />
          </Field>
          <Field label="今日感受">
            <TextArea rows={2} value={draft.feeling} onChange={(v) => patch({ feeling: v })} />
          </Field>
          <Field label="疲劳程度（1-10）">
            <NumberInput value={draft.fatigue} onChange={(v) => patch({ fatigue: v })} />
          </Field>
          <Field label="备注">
            <TextArea rows={2} value={draft.note} onChange={(v) => patch({ note: v })} />
          </Field>
          <ListRow
            title="同时写入身体数据"
            sub="把体重与睡眠合并到「数据」页"
            right={
              <button
                className={`switch ${alsoWeight ? 'on' : ''}`}
                role="switch"
                aria-checked={alsoWeight}
                aria-label="同时写入身体数据"
                onClick={() => setAlsoWeight((v) => !v)}
              />
            }
          />
        </div>
      </Card>

      <div className="sticky-actions">
        <Button block size="xl" variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '正在合并…' : '确认合并保存'}
        </Button>
      </div>
    </Page>
  );
}

/* --------------------------------------------------------- 身体数据确认 */

function BodyConfirm({ draft }: { draft: BodyDraft }) {
  const [entries, setEntries] = useState(draft.entries.map((e) => ({ ...e, selected: true })));
  const [saving, setSaving] = useState(false);
  const { saveBodyMetric, markPdfImportSaved, bodyMetrics } = useAppData();
  const toast = useToast();
  const navigate = useNavigate();
  const selected = entries.filter((e) => e.selected);

  const save = async () => {
    if (!selected.length) {
      toast('请至少选择一条记录', 'error');
      return;
    }
    setSaving(true);
    try {
      const metrics: BodyMetric[] = bodyEntriesToMetrics(selected);
      for (const m of metrics) {
        await saveBodyMetric({
          date: m.date,
          weightKg: m.weightKg ?? null,
          bodyFatPct: m.bodyFatPct ?? null,
          sleepHours: m.sleepHours ?? null,
          restingHr: m.restingHr ?? null,
        });
      }
      await markPdfImportSaved(draft.importId, { kind: 'body-report' });
      clearDraftFromSession();
      toast(`已写入 ${metrics.length} 条身体数据`, 'success');
      navigate('/data');
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="确认身体数据" sub={`${draft.fileName} · ${draft.entries.length} 条`} back>
      <Card>
        <div className="import-meta">
          <Chip tone="accent">身体数据报告</Chip>
          <Chip>已选 {selected.length} 条</Chip>
        </div>
        <ConfidenceBar value={draft.confidence} />
        <Warnings items={draft.warnings} />
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          同一天已有数据时会被覆盖为这里的数值（可先取消勾选）。
        </p>
      </Card>

      <div className="list">
        {entries.map((e, i) => {
          const exists = bodyMetrics.some((m) => m.date === e.date);
          return (
            <div className="list-row" key={e.date} style={{ alignItems: 'flex-start' }}>
              <button
                className={`set-dot ${e.selected ? 'done' : ''}`}
                aria-label={e.selected ? '取消选择' : '选择'}
                onClick={() =>
                  setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))
                }
              >
                {e.selected ? '✓' : ''}
              </button>
              <div className="grow col" style={{ gap: 8 }}>
                <div className="row-between">
                  <span className="strong">{formatDateCN(e.date)}</span>
                  {exists && <Chip tone="orange">将覆盖</Chip>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <Field label="体重 kg">
                      <NumberInput
                        value={e.weightKg}
                        onChange={(v) =>
                          setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, weightKg: v } : x)))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="体脂 %">
                      <NumberInput
                        value={e.bodyFatPct}
                        onChange={(v) =>
                          setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, bodyFatPct: v } : x)))
                        }
                      />
                    </Field>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="grow">
                    <Field label="睡眠 小时">
                      <NumberInput
                        value={e.sleepHours}
                        onChange={(v) =>
                          setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, sleepHours: v } : x)))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="静息心率">
                      <NumberInput
                        value={e.restingHr}
                        dec={0}
                        onChange={(v) =>
                          setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, restingHr: v } : x)))
                        }
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky-actions">
        <Button block size="xl" variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? '正在写入…' : `保存所选 ${selected.length} 条`}
        </Button>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------- 周计划确认 */

function WeeklyConfirm({
  draft,
  savedRecord,
}: {
  draft: WeeklyDraft;
  savedRecord?: { planId?: string | null } | null;
}) {
  const [selected, setSelected] = useState<boolean[]>(() => draft.days.map(() => true));
  const [saving, setSaving] = useState(false);
  const { createPlanFromDraft, markPdfImportSaved } = useAppData();
  const toast = useToast();
  const navigate = useNavigate();

  const save = async (copySaved = false) => {
    if (savedRecord && !copySaved) {
      toast('这是上次已保存的周计划，请点击「复制为新周计划」明确创建副本', 'error');
      return;
    }
    const days = draft.days.filter((_, i) => selected[i]);
    if (!days.length) {
      toast('请至少选择一天', 'error');
      return;
    }
    setSaving(true);
    try {
      let firstId: string | null = null;
      for (const day of days) {
        const plan = await createPlanFromDraft(day);
        firstId = firstId ?? plan.id;
      }
      if (!copySaved) {
        await markPdfImportSaved(draft.importId, { planId: firstId, kind: 'weekly-plan' });
      }
      clearDraftFromSession();
      toast(
        copySaved ? `已复制 ${days.length} 天的训练安排` : `已保存 ${days.length} 天的训练安排`,
        'success',
      );
      navigate('/train');
    } catch (err) {
      toast(`保存失败：${err instanceof Error ? err.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="确认周计划" sub={`${draft.fileName} · ${draft.days.length} 天`} back>
      {savedRecord && (
        <Card>
          <div className="strong" style={{ marginBottom: 6 }}>这是上次已保存的导入结果</div>
          <div className="tiny muted" style={{ lineHeight: 1.7 }}>
            为避免重复计划，再次查看不会自动创建。只有点击「复制为新周计划」时才会新增所选的每日计划，原导入记录和原计划不会被修改。
          </div>
        </Card>
      )}

      <Card>
        <div className="import-meta">
          <Chip tone="accent">周训练计划</Chip>
          <Chip>已选 {selected.filter(Boolean).length} 天</Chip>
        </div>
        <Warnings items={draft.warnings} />
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {savedRecord
            ? '当前为已保存结果复查；如需再次使用，请明确点击下方复制按钮。'
            : '保存后会生成多份独立计划，每天各自保存，互不覆盖。'}
        </p>
      </Card>

      <div className="list">
        {draft.days.map((day, i) => (
          <div className="day-row" key={`${day.title}-${i}`}>
            <button
              className={`set-dot ${selected[i] ? 'done' : ''}`}
              aria-label={selected[i] ? '取消选择' : '选择'}
              onClick={() => setSelected((prev) => prev.map((v, j) => (j === i ? !v : v)))}
            >
              {selected[i] ? '✓' : ''}
            </button>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="strong truncate">{day.title}</div>
              <div className="tiny muted">
                {formatDateCN(day.date)} · {SESSION_KIND_LABEL[day.sessionKind]} ·{' '}
                {day.exercises.length} 个动作
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky-actions">
        <Button
          block
          size="xl"
          variant="primary"
          disabled={saving}
          onClick={() => void save(savedRecord != null)}
        >
          {saving
            ? savedRecord
              ? '正在复制…'
              : '正在保存…'
            : savedRecord
              ? '复制为新周计划'
              : `保存所选 ${selected.filter(Boolean).length} 天`}
        </Button>
      </div>
    </Page>
  );
}

/* --------------------------------------------------------------- 扫描版 */

function OcrNotice({ draft }: { draft: Extract<AnyDraft, { kind: 'ocr' }> }) {
  const { deletePdfImport } = useAppData();
  const navigate = useNavigate();
  return (
    <Page title="需要 OCR 才能识别" sub={draft.fileName} back hideTab>
      <Card>
        <EmptyState
          emoji="🔍"
          title="这是扫描版 PDF"
          desc={`这份文件共 ${draft.pageCount} 页，但没有文字层（图片扫描件），所以无法直接读取内容。`}
        />
      </Card>
      <Card>
        <div className="col" style={{ gap: 10 }}>
          <div className="strong">你可以这样做</div>
          <p className="small muted" style={{ margin: 0 }}>
            1. 在 iPhone 上用「文件」打开 PDF → 长按文字用「实时文本」，或截图后用相册文字识别，把内容复制出来；
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            2. 让 ChatGPT 重新导出为「文字型 PDF」（可选中文字的那种）再导入；
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            3. 或者直接在「训练」页手动新建计划，其余功能照常使用。
          </p>
        </div>
      </Card>
      <div className="col" style={{ gap: 10, marginTop: 8 }}>
        <Button
          block
          size="lg"
          variant="primary"
          onClick={() => {
            void deletePdfImport(draft.importId);
            navigate('/train');
          }}
        >
          <IconImport width={18} height={18} />
          知道了，去手动创建计划
        </Button>
        <Button block size="lg" variant="ghost" onClick={() => navigate(-1)}>
          返回上一页
        </Button>
      </div>
      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 14 }}>
        提示：其他功能（训练、数据、总结、备份）不受影响。
      </p>
    </Page>
  );
}

/* ------------------------------------------------------------------ 入口 */

export default function ImportConfirmPage() {
  const [params] = useSearchParams();
  const importId = params.get('import');
  const { pdfImports, ready } = useAppData();
  const navigate = useNavigate();

  const savedRecord = useMemo(
    () => (importId ? pdfImports.find((record) => record.id === importId && record.saved) ?? null : null),
    [importId, pdfImports],
  );

  // 优先级：sessionStorage 草稿 -> ?import=<id> 从 IndexedDB 记录重新解析
  const draft = useMemo(() => {
    const local = readDraftFromSession();
    if (local && (!importId || local.importId === importId)) return local;
    if (importId) {
      const record = pdfImports.find((r) => r.id === importId);
      if (record) return buildDraft(record);
    }
    return local;
  }, [importId, pdfImports]);

  if (!ready) {
    return (
      <Page title="导入确认" back>
        <Card flat>
          <div className="skeleton" style={{ height: 18, width: '60%' }} />
          <div className="skeleton" style={{ height: 14, marginTop: 10 }} />
          <div className="skeleton" style={{ height: 14, marginTop: 8, width: '80%' }} />
        </Card>
      </Page>
    );
  }

  if (!draft) {
    return (
      <Page title="导入" back>
        <EmptyState
          emoji="📄"
          title="没有待确认的导入"
          desc="请先在首页或训练页选择一份 PDF 文件。"
          action={
            <Button variant="primary" size="lg" onClick={() => navigate('/train')}>
              去导入 PDF
            </Button>
          }
        />
      </Page>
    );
  }

  switch (draft.kind) {
    case 'plan':
      return <PlanConfirm draft={draft} savedRecord={savedRecord} />;
    case 'weekly-plan':
      return <WeeklyConfirm draft={draft} savedRecord={savedRecord} />;
    case 'daily-summary':
      return <SummaryConfirm draft={draft} />;
    case 'body-report':
      return <BodyConfirm draft={draft} />;
    case 'ocr':
      return <OcrNotice draft={draft} />;
  }
}
