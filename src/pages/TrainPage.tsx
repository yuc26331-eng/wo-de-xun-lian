/**
 * 训练页
 * 计划 / 动作库 / 模板 / 历史 + PDF 导入 + 实时跟练入口
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import { PdfDropZone, PdfImportButton } from '../components/PdfImportButton';
import {
  Button,
  Card,
  Confirm,
  EmptyState,
  Field,
  ListRow,
  NumberInput,
  SectionTitle,
  Segmented,
  Select,
  Sheet,
  Stepper,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { IconPlus, IconTrash } from '../components/icons';
import { exportPlanPdf } from '../lib/report/exportPdf';
import { buildLiveSession, sessionProgress } from '../lib/session';
import {
  KIND_EMOJI,
  addDays,
  formatDateShort,
  formatDateCN,
  formatVolume,
  nowISO,
  targetSummary,
  toISODate,
  uid,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import {
  SESSION_KIND_LABEL,
  type ExerciseDef,
  type ExerciseItem,
  type ISODate,
  type SessionKind,
  type TrainingPlan,
} from '../types';

type Tab = 'plans' | 'library' | 'templates' | 'history';

const KIND_OPTIONS: { value: SessionKind; label: string }[] = (
  Object.keys(SESSION_KIND_LABEL) as SessionKind[]
).map((k) => ({ value: k, label: SESSION_KIND_LABEL[k] }));

function emptyPlan(date: ISODate, kind: SessionKind): TrainingPlan {
  const now = nowISO();
  return {
    id: uid('plan'),
    title: '',
    date,
    kind,
    source: 'manual',
    estimatedMinutes: 60,
    warmup: [],
    exercises: [],
    cooldown: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* 计划编辑器                                                          */
/* ------------------------------------------------------------------ */

function PlanEditor({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: TrainingPlan | null;
  onClose: () => void;
  onSave: (plan: TrainingPlan) => Promise<void>;
}) {
  const { exercises: library, settings } = useAppData();
  const [draft, setDraft] = useState<TrainingPlan | null>(initial);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // 每次打开时同步外部传入的计划
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && initial && openedFor !== initial.id) {
    setOpenedFor(initial.id);
    setDraft(initial);
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const patch = (p: Partial<TrainingPlan>) => setDraft((d) => (d ? { ...d, ...p } : d));

  function addExercise(def: ExerciseDef) {
    if (!draft) return;
    const item: ExerciseItem = {
      id: uid('ex'),
      name: def.name,
      kind: def.kind,
      cue: def.cue,
      target: {
        sets: 3,
        reps: def.kind === 'strength' ? '10' : null,
        restSec: settings.defaultRestSec,
        durationSec: def.kind === 'strength' ? null : 600,
      },
      order: draft.exercises.length,
    };
    patch({ exercises: [...draft.exercises, item] });
    setPicker(false);
  }

  function updateExercise(id: string, p: Partial<ExerciseItem>) {
    if (!draft) return;
    patch({
      exercises: draft.exercises.map((e) => (e.id === id ? { ...e, ...p } : e)),
    });
  }

  async function submit() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await onSave({
        ...draft,
        title: draft.title.trim() || '未命名训练',
        exercises: draft.exercises.map((e, i) => ({ ...e, order: i })),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open || !draft) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={initial && initial.title ? '编辑训练计划' : '新建训练计划'}
      footer={
        <Button block variant="primary" size="lg" onClick={() => void submit()} disabled={saving}>
          {saving ? '保存中…' : '保存计划'}
        </Button>
      }
    >
      <Field label="计划名称">
        <TextInput value={draft.title} onChange={(v) => patch({ title: v })} placeholder="例如：下肢力量 + 爆发力" />
      </Field>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <div className="grow">
          <Field label="日期">
            <TextInput
              type="date"
              value={draft.date ?? toISODate()}
              onChange={(v) => patch({ date: v as ISODate })}
            />
          </Field>
        </div>
        <div className="grow">
          <Field label="预计时长（分钟）">
            <NumberInput
              value={draft.estimatedMinutes ?? null}
              onChange={(v) => patch({ estimatedMinutes: v })}
              dec={0}
              placeholder="60"
            />
          </Field>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="训练类型">
          <Select
            value={draft.kind}
            onChange={(v) => patch({ kind: v })}
            options={KIND_OPTIONS}
          />
        </Field>
      </div>

      <SectionTitle action="+ 添加动作" onAction={() => setPicker(true)}>
        动作（{draft.exercises.length}）
      </SectionTitle>
      {draft.exercises.length === 0 && (
        <div className="tiny muted" style={{ padding: '4px 4px 10px' }}>
          还没有动作，点右上角「添加动作」从动作库选择，或直接导入 ChatGPT PDF。
        </div>
      )}
      <div className="col" style={{ gap: 10 }}>
        {draft.exercises.map((ex, i) => (
          <div key={ex.id} className="plan-edit-row">
            <div className="row-between">
              <span className="strong truncate">
                {i + 1}. {ex.name}
              </span>
              <button
                className="icon-btn"
                aria-label="删除动作"
                onClick={() => patch({ exercises: draft.exercises.filter((e) => e.id !== ex.id) })}
              >
                <IconTrash width={18} height={18} />
              </button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <div className="mini-field">
                <span className="tiny muted">组数</span>
                <Stepper
                  value={ex.target.sets ?? 3}
                  min={1}
                  max={20}
                  onChange={(v) => updateExercise(ex.id, { target: { ...ex.target, sets: v } })}
                />
              </div>
              <div className="mini-field">
                <span className="tiny muted">次数</span>
                <TextInput
                  value={ex.target.reps ?? ''}
                  onChange={(v) => updateExercise(ex.id, { target: { ...ex.target, reps: v } })}
                  placeholder="10"
                />
              </div>
              <div className="mini-field">
                <span className="tiny muted">重量 kg</span>
                <NumberInput
                  value={ex.target.weightKg ?? null}
                  onChange={(v) => updateExercise(ex.id, { target: { ...ex.target, weightKg: v } })}
                  placeholder="—"
                />
              </div>
              <div className="mini-field">
                <span className="tiny muted">休息秒</span>
                <NumberInput
                  value={ex.target.restSec ?? null}
                  onChange={(v) => updateExercise(ex.id, { target: { ...ex.target, restSec: v } })}
                  dec={0}
                  placeholder="90"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="热身与恢复安排">
          <TextArea
            value={draft.cooldown ?? ''}
            onChange={(v) => patch({ cooldown: v })}
            placeholder="例如：慢跑 5 分钟 + 动态拉伸；训练后泡沫轴放松大腿前侧"
            rows={2}
          />
        </Field>
      </div>

      <Sheet open={picker} onClose={() => setPicker(false)} title="从动作库选择">
        <div className="col" style={{ gap: 8 }}>
          {library.slice(0, 60).map((def) => (
            <button key={def.id} className="list-row tap" onClick={() => addExercise(def)}>
              <span className="grow" style={{ textAlign: 'left' }}>
                <span className="strong" style={{ display: 'block' }}>
                  {KIND_EMOJI[def.kind]} {def.name}
                </span>
                <span className="tiny muted">
                  {(def.primaryMuscles ?? []).join('、')}
                  {def.equipment ? ` · ${def.equipment}` : ''}
                </span>
              </span>
              <IconPlus width={18} height={18} />
            </button>
          ))}
        </div>
      </Sheet>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* 训练页                                                              */
/* ------------------------------------------------------------------ */

export default function TrainPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const {
    ready,
    plans,
    summaries,
    exercises: library,
    templates,
    settings,
    liveSession,
    setLiveSession,
    savePlan,
    deletePlan,
    duplicatePlan,
    savePlanAsTemplate,
    togglePlanArchive,
    renamePlan,
    saveExercise,
    deleteExercise,
    deleteTemplate,
  } = useAppData();

  const today = toISODate();
  const [tab, setTab] = useState<Tab>('plans');
  const [editorPlan, setEditorPlan] = useState<TrainingPlan | null>(null);
  const [actionsPlan, setActionsPlan] = useState<TrainingPlan | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TrainingPlan | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(today);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryKind, setLibraryKind] = useState<SessionKind | 'all'>('all');
  const [newExerciseOpen, setNewExerciseOpen] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseKind, setNewExerciseKind] = useState<SessionKind>('strength');
  const [newExerciseCue, setNewExerciseCue] = useState('');

  const liveActive = liveSession != null && (liveSession.status === 'active' || liveSession.status === 'paused');
  const progress = liveActive && liveSession ? sessionProgress(liveSession) : null;

  const sortedPlans = useMemo(
    () =>
      [...plans].sort((a, b) => {
        const da = a.date ?? '';
        const db = b.date ?? '';
        return da < db ? 1 : -1;
      }),
    [plans],
  );
  const todayPlans = sortedPlans.filter((p) => p.date === today && !p.archived);
  const otherPlans = sortedPlans.filter((p) => p.date !== today && !p.archived);
  const archivedPlans = sortedPlans.filter((p) => p.archived);

  const filteredLibrary = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return library.filter((e) => {
      if (libraryKind !== 'all' && e.kind !== libraryKind) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.primaryMuscles ?? []).some((m) => m.toLowerCase().includes(q)) ||
        (e.equipment ?? '').toLowerCase().includes(q)
      );
    });
  }, [library, libraryKind, libraryQuery]);

  async function startPlan(plan: TrainingPlan) {
    if (liveActive && liveSession) {
      navigate('/live');
      return;
    }
    const session = buildLiveSession(plan, { defaultRestSec: settings.defaultRestSec });
    await setLiveSession(session);
    navigate('/live');
  }

  async function useTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const now = nowISO();
    const plan: TrainingPlan = {
      id: uid('plan'),
      title: tpl.name,
      date: today,
      kind: tpl.kind,
      source: 'template',
      estimatedMinutes: tpl.estimatedMinutes ?? null,
      warmup: tpl.warmup,
      exercises: tpl.exercises.map((e, i) => ({ ...e, id: uid('ex'), order: i })),
      cooldown: '',
      notes: tpl.note ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await savePlan(plan);
    setTab('plans');
    toast('已用模板创建今天的计划', 'success');
  }

  async function addExercise() {
    const name = newExerciseName.trim();
    if (!name) {
      toast('请输入动作名称', 'error');
      return;
    }
    await saveExercise({
      id: uid('exd'),
      name,
      kind: newExerciseKind,
      primaryMuscles: [],
      cue: newExerciseCue.trim() || undefined,
      custom: true,
      tags: ['自定义'],
    });
    setNewExerciseName('');
    setNewExerciseCue('');
    setNewExerciseOpen(false);
    toast('已添加到动作库', 'success');
  }

  if (!ready) {
    return (
      <Page title="训练">
        <div className="skeleton" style={{ height: 160 }} />
      </Page>
    );
  }

  return (
    <Page title="训练" sub={liveActive ? '有未完成的训练' : undefined}>
      {liveActive && liveSession && progress && (
        <Card className="live-banner">
          <div className="row-between">
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ color: 'var(--accent)', fontWeight: 650 }}>
                {liveSession.status === 'paused' ? '训练已暂停' : '训练进行中'}
              </div>
              <div className="strong truncate" style={{ fontSize: 16, marginTop: 2 }}>
                {liveSession.planTitle}
              </div>
              <div className="tiny muted" style={{ marginTop: 2 }}>
                已完成 {progress.doneSets}/{progress.plannedSets} 组
              </div>
            </div>
            <Button variant="primary" onClick={() => navigate('/live')}>
              继续训练
            </Button>
          </div>
        </Card>
      )}

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'plans', label: '计划' },
          { value: 'library', label: '动作库' },
          { value: 'templates', label: '模板' },
          { value: 'history', label: '历史' },
        ]}
      />

      {tab === 'plans' && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="strong" style={{ fontSize: 16 }}>
              导入 ChatGPT PDF
            </div>
            <div className="tiny muted" style={{ marginTop: 4, marginBottom: 12 }}>
              iPhone 可用「文件」选择，电脑可直接拖拽。解析在本机完成，不会上传健康资料。
            </div>
            <PdfImportButton variant="primary" block size="lg" label="选择 PDF 文件" testId="import-pdf-train" />
            <div style={{ marginTop: 10 }}>
              <PdfDropZone label="拖拽 PDF 到此处导入" compact />
            </div>
          </Card>

          <div className="row" style={{ gap: 10, marginBottom: 4 }}>
            <Button block size="lg" variant="primary" onClick={() => setEditorPlan(emptyPlan(today, 'strength'))}>
              <IconPlus width={18} height={18} style={{ marginRight: 6 }} /> 新建计划
            </Button>
          </div>

          {todayPlans.length > 0 && (
            <>
              <SectionTitle>今天</SectionTitle>
              <div className="list">
                {todayPlans.map((p) => (
                  <ListRow
                    key={p.id}
                    title={`${KIND_EMOJI[p.kind]} ${p.title}`}
                    sub={`${p.exercises.length} 个动作${p.estimatedMinutes ? ` · 预计 ${p.estimatedMinutes} 分钟` : ''}`}
                    right={
                      <Button size="sm" variant="primary" onClick={() => void startPlan(p)}>
                        开始
                      </Button>
                    }
                    onClick={() => setActionsPlan(p)}
                  />
                ))}
              </div>
            </>
          )}

          <SectionTitle>{todayPlans.length > 0 ? '其他计划' : '训练计划'}</SectionTitle>
          {otherPlans.length === 0 && todayPlans.length === 0 ? (
            <Card>
              <EmptyState
                emoji="📋"
                title="还没有训练计划"
                desc="导入 ChatGPT 导出的 PDF，或手动新建一个计划"
              />
            </Card>
          ) : (
            <div className="list">
              {otherPlans.map((p) => (
                <ListRow
                  key={p.id}
                  title={`${KIND_EMOJI[p.kind]} ${p.title}`}
                  sub={`${p.date ? formatDateShort(p.date) : '未定日期'} · ${p.exercises.length} 个动作`}
                  value={p.estimatedMinutes ? `${p.estimatedMinutes}′` : undefined}
                  onClick={() => setActionsPlan(p)}
                />
              ))}
            </div>
          )}

          {archivedPlans.length > 0 && (
            <>
              <SectionTitle>已归档</SectionTitle>
              <div className="list">
                {archivedPlans.map((p) => (
                  <ListRow
                    key={p.id}
                    title={`${KIND_EMOJI[p.kind]} ${p.title}`}
                    sub={p.date ? formatDateShort(p.date) : '未定日期'}
                    onClick={() => setActionsPlan(p)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'library' && (
        <div style={{ marginTop: 14 }}>
          <Field label="搜索动作 / 肌群 / 器械">
            <TextInput value={libraryQuery} onChange={setLibraryQuery} placeholder="例如：深蹲、腘绳肌、杠铃" />
          </Field>
          <div style={{ marginTop: 10 }}>
            <Segmented<SessionKind | 'all'>
              value={libraryKind}
              onChange={setLibraryKind}
              options={[
                { value: 'all', label: '全部' },
                { value: 'strength', label: '力量' },
                { value: 'run', label: '跑步' },
                { value: 'football', label: '足球' },
                { value: 'stretch', label: '拉伸' },
              ]}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button block size="lg" onClick={() => setNewExerciseOpen(true)}>
              <IconPlus width={18} height={18} style={{ marginRight: 6 }} /> 添加自定义动作
            </Button>
          </div>
          <SectionTitle>{filteredLibrary.length} 个动作</SectionTitle>
          <div className="list">
            {filteredLibrary.map((def) => (
              <ListRow
                key={def.id}
                title={`${KIND_EMOJI[def.kind]} ${def.name}`}
                sub={[
                  (def.primaryMuscles ?? []).join('、'),
                  def.equipment,
                  def.cue,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  def.custom ? (
                    <button
                      className="icon-btn"
                      aria-label="删除动作"
                      onClick={() => void deleteExercise(def.id)}
                    >
                      <IconTrash width={18} height={18} />
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div style={{ marginTop: 14 }}>
          {templates.length === 0 ? (
            <Card>
              <EmptyState
                emoji="🧩"
                title="还没有训练模板"
                desc="在计划详情里选择「存为模板」，之后可以一键生成今天的训练"
              />
            </Card>
          ) : (
            <div className="list">
              {templates.map((t) => (
                <ListRow
                  key={t.id}
                  title={`${KIND_EMOJI[t.kind]} ${t.name}`}
                  sub={`${t.exercises.length} 个动作${t.estimatedMinutes ? ` · ${t.estimatedMinutes} 分钟` : ''}`}
                  right={
                    <div className="row" style={{ gap: 6 }}>
                      <Button size="sm" variant="primary" onClick={() => void useTemplate(t.id)}>
                        使用
                      </Button>
                      <button
                        className="icon-btn"
                        aria-label="删除模板"
                        onClick={() => void deleteTemplate(t.id)}
                      >
                        <IconTrash width={18} height={18} />
                      </button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div style={{ marginTop: 14 }}>
          {summaries.length === 0 ? (
            <Card>
              <EmptyState emoji="📈" title="还没有训练记录" desc="完成训练后会自动生成总结" />
            </Card>
          ) : (
            <div className="list">
              {[...summaries]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .slice(0, 30)
                .map((s) => (
                  <ListRow
                    key={s.id}
                    title={`${KIND_EMOJI[s.kind]} ${s.planTitle}`}
                    sub={`${formatDateShort(s.date)} · 完成 ${Math.round(s.completionRate * 100)}% · ${s.totalSets} 组`}
                    value={s.kind === 'strength' || s.kind === 'other' ? formatVolume(s.totalVolumeKg) : undefined}
                    onClick={() => navigate('/history')}
                  />
                ))}
            </div>
          )}
          <Button block size="lg" style={{ marginTop: 12 }} onClick={() => navigate('/history')}>
            打开完整训练历史
          </Button>
        </div>
      )}

      {/* 计划操作 */}
      <Sheet
        open={actionsPlan != null}
        onClose={() => setActionsPlan(null)}
        title={actionsPlan?.title ?? ''}
        footer={
          actionsPlan && (
            <div className="col" style={{ gap: 10 }}>
              <Button
                block
                variant="primary"
                size="lg"
                onClick={() => {
                  const p = actionsPlan;
                  setActionsPlan(null);
                  void startPlan(p);
                }}
              >
                {liveActive ? '继续训练' : '开始这个计划'}
              </Button>
              <Button
                block
                size="lg"
                onClick={() => {
                  setEditorPlan(actionsPlan);
                  setActionsPlan(null);
                }}
              >
                编辑计划
              </Button>
            </div>
          )
        }
      >
        {actionsPlan && (
          <div className="col" style={{ gap: 10 }}>
            {actionsPlan.exercises.slice(0, 6).map((ex, i) => (
              <div key={ex.id} className="row-between">
                <span className="truncate">
                  {i + 1}. {ex.name}
                </span>
                <span className="tiny muted nowrap">{targetSummary(ex.target)}</span>
              </div>
            ))}
            <div className="divider" />
            <Button
              block
              onClick={() => {
                setTemplateName(actionsPlan.title);
                setTemplateOpen(true);
              }}
            >
              存为训练模板
            </Button>
            <Button
              block
              data-testid="plan-rename"
              onClick={() => {
                setRenameValue(actionsPlan.title);
                setRenameOpen(true);
              }}
            >
              重命名
            </Button>
            <Button
              block
              data-testid="plan-copy"
              onClick={() => {
                setCopyDate(addDays(actionsPlan.date ?? today, 1));
                setCopyOpen(true);
              }}
            >
              复制到其他日期
            </Button>
            <Button
              block
              onClick={() => void exportPlanPdf(actionsPlan).catch(() => toast('导出失败', 'error'))}
            >
              导出计划 PDF
            </Button>
            <Button block onClick={() => void togglePlanArchive(actionsPlan.id)}>
              {actionsPlan.archived ? '取消归档' : '归档'}
            </Button>
            <Button block variant="danger" onClick={() => setConfirmDelete(actionsPlan)}>
              删除计划
            </Button>
          </div>
        )}
      </Sheet>

      <Confirm
        open={confirmDelete != null}
        title="删除这个计划？"
        message={
          confirmDelete
            ? `将删除「${confirmDelete.title}」（${
                confirmDelete.date ? formatDateCN(confirmDelete.date) : '未设置日期'
              }）。删除后无法恢复，已完成的训练记录不会被删除。`
            : ''
        }
        confirmText="删除"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const id = confirmDelete?.id;
          setConfirmDelete(null);
          setActionsPlan(null);
          if (id) void deletePlan(id).then(() => toast('计划已删除'));
        }}
      />

      {/* 重命名计划 */}
      <Sheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="重命名训练计划"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            data-testid="plan-rename-save"
            onClick={async () => {
              if (!actionsPlan) return;
              await renamePlan(actionsPlan.id, renameValue);
              setActionsPlan({ ...actionsPlan, title: renameValue.trim() || actionsPlan.title });
              setRenameOpen(false);
              toast('已重命名', 'success');
            }}
          >
            保存名称
          </Button>
        }
      >
        <Field label="计划名称">
          <TextInput value={renameValue} onChange={setRenameValue} testId="plan-rename-input" />
        </Field>
      </Sheet>

      {/* 复制计划到指定日期 */}
      <Sheet
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="复制到其他日期"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            data-testid="plan-copy-save"
            onClick={async () => {
              if (!actionsPlan) return;
              await duplicatePlan(actionsPlan.id, copyDate);
              setCopyOpen(false);
              setActionsPlan(null);
              toast(`已复制到 ${copyDate}`, 'success');
            }}
          >
            确认复制
          </Button>
        }
      >
        <Field label="目标日期">
          <input
            className="input"
            type="date"
            value={copyDate}
            data-testid="plan-copy-date"
            onChange={(e) => setCopyDate(e.target.value)}
          />
        </Field>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          复制会生成一份新的计划（含全部动作与热身），不会覆盖原有计划。
        </div>
      </Sheet>

      {/* 存为模板 */}
      <Sheet
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="存为训练模板"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            onClick={() => {
              const id = actionsPlan?.id ?? editorPlan?.id;
              if (!id) return;
              void savePlanAsTemplate(id, templateName).then(() => {
                setTemplateOpen(false);
                setActionsPlan(null);
                toast('已保存为模板', 'success');
              });
            }}
          >
            保存模板
          </Button>
        }
      >
        <Field label="模板名称">
          <TextInput value={templateName} onChange={setTemplateName} placeholder="例如：下肢力量 A" />
        </Field>
      </Sheet>

      {/* 自定义动作 */}
      <Sheet
        open={newExerciseOpen}
        onClose={() => setNewExerciseOpen(false)}
        title="添加自定义动作"
        footer={
          <Button block variant="primary" size="lg" onClick={() => void addExercise()}>
            添加
          </Button>
        }
      >
        <Field label="动作名称">
          <TextInput value={newExerciseName} onChange={setNewExerciseName} placeholder="例如：单腿硬拉" />
        </Field>
        <div style={{ marginTop: 12 }}>
          <Field label="类型">
            <Select value={newExerciseKind} onChange={setNewExerciseKind} options={KIND_OPTIONS} />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="动作要领（可选）">
            <TextArea value={newExerciseCue} onChange={setNewExerciseCue} rows={2} placeholder="例如：髋关节后移，保持背部中立" />
          </Field>
        </div>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          计划里还需要手动设置组数、次数与重量。
        </div>
      </Sheet>

      <PlanEditor
        open={editorPlan != null}
        initial={editorPlan}
        onClose={() => setEditorPlan(null)}
        onSave={async (plan) => {
          await savePlan(plan);
          setEditorPlan(null);
          toast('计划已保存', 'success');
        }}
      />
    </Page>
  );
}
