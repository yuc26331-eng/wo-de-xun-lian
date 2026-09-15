/**
 * 今日总结表单：六大分区（训练 / Apple Watch / 睡眠 / 身体恢复 / 饮食补剂 / 自由记录）
 * - 输入即自动保存（800ms 防抖），刷新、退出、误关页面都不会丢
 * - 同一天只维护一条记录（id = 日期），重复编辑是更新而不是新增
 * - 保存时同步兼容字段与身体数据，保证其它页面（数据/首页）读到同样的值
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyLog, ISODate, SessionKind } from '../../types';
import { SESSION_KIND_LABEL } from '../../types';
import { Button, Card, Chip, Confirm, Field, NumberInput, Select, TextArea, TextInput, useToast } from '../ui';
import { IconTrash } from '../icons';
import { PAIN_SITES } from '../../lib/session';
import { useAppData } from '../../state/AppData';
import { dailyProgress, normalizeDailyLog, type SectionKey } from '../../lib/summary/sections';
import { AttachmentsSection } from './AttachmentsSection';

const KIND_OPTIONS = [
  { value: '', label: '未记录' },
  ...(Object.keys(SESSION_KIND_LABEL) as SessionKind[]).map((k) => ({
    value: k,
    label: SESSION_KIND_LABEL[k],
  })),
];

type Status = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

function Collapse({
  title,
  emoji,
  progress,
  open,
  onToggle,
  children,
}: {
  title: string;
  emoji: string;
  progress: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="collapse-card">
      <button className="collapse-head" onClick={onToggle} aria-expanded={open}>
        <span className="collapse-emoji">{emoji}</span>
        <span className="grow" style={{ textAlign: 'left' }}>
          <span className="strong" style={{ fontSize: 16 }}>
            {title}
          </span>
        </span>
        <span className="tiny muted nowrap">{progress}</span>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </Card>
  );
}

/** 1~5 分主观量表 */
function Scale({
  value,
  onChange,
  labels,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  labels?: string[];
}) {
  return (
    <div className="scale-row">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`scale-dot ${value === n ? 'active' : ''}`}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? null : n)}
        >
          {labels?.[n - 1] ?? n}
        </button>
      ))}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="form-row" style={{ marginTop: 10 }}>
      {children}
    </div>
  );
}

export interface SummaryFormProps {
  date: ISODate;
  log: DailyLog | null;
  onSaved?: (log: DailyLog) => void;
  onDeleted?: () => void;
  onCopyRequest?: () => void;
  onExportRequest?: () => void;
}

export function SummaryForm({
  date,
  log,
  onSaved,
  onDeleted,
  onCopyRequest,
  onExportRequest,
}: SummaryFormProps) {
  const toast = useToast();
  const { saveDailyLog, deleteDailyLog, saveBodyMetric } = useAppData();
  const [draft, setDraft] = useState<DailyLog>(() => normalizeDailyLog(log, date));
  const [status, setStatus] = useState<Status>('clean');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(log?.updatedAt ?? null);
  const [open, setOpen] = useState<SectionKey | null>('training');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = useRef(false);
  const dateRef = useRef(date);

  // 切换日期时重新载入（同一天的外部更新不覆盖正在编辑的内容）
  useEffect(() => {
    if (dateRef.current === date) return;
    dateRef.current = date;
    dirty.current = false;
    setDraft(normalizeDailyLog(log, date));
    setStatus('clean');
  }, [date, log]);

  const patch = useCallback((fn: (prev: DailyLog) => DailyLog) => {
    setDraft((prev) => fn(prev));
    dirty.current = true;
    setStatus('dirty');
  }, []);

  const set = useCallback(
    <K extends keyof DailyLog>(key: K, value: DailyLog[K]) =>
      patch((prev) => ({ ...prev, [key]: value })),
    [patch],
  );

  const setSection = useCallback(
    <
      K extends 'training' | 'watch' | 'sleep' | 'body' | 'meals' | 'supplements',
    >(
      key: K,
      value: Partial<NonNullable<DailyLog[K]>>,
    ) =>
      patch((prev) => ({
        ...prev,
        [key]: { ...(prev[key] as object | undefined), ...value },
      })),
    [patch],
  );

  const persist = useCallback(async () => {
    setStatus('saving');
    try {
      const training = draft.training ?? {};
      const body = draft.body ?? {};
      const sleep = draft.sleep ?? {};
      const meals = draft.meals ?? {};
      const supplements = draft.supplements ?? {};
      const saved = await saveDailyLog({
        ...draft,
        date,
        id: date,
        // 兼容 v1 字段：其它页面（数据/首页/导出）继续可用
        weightKg: body.weightKg ?? null,
        fatigue: body.fatigue ?? null,
        pain: body.injuryPain ?? '',
        feeling: body.overall ?? training.feeling ?? '',
        rpe: training.rpe ?? null,
        trainingContent: training.items ?? '',
        trainingVolumeKg: training.volumeKg ?? null,
        sleepHours: sleep.totalHours ?? null,
        diet: meals.note ?? '',
        note: draft.freeNote ?? '',
        supplements,
      });
      if (body.weightKg != null || body.bodyFatPct != null) {
        await saveBodyMetric({
          date,
          weightKg: body.weightKg ?? null,
          bodyFatPct: body.bodyFatPct ?? null,
        });
      }
      dirty.current = false;
      setStatus('saved');
      setLastSavedAt(saved.updatedAt);
      onSaved?.(saved);
    } catch (err) {
      console.error('[summary] 保存失败', err);
      setStatus('error');
      toast('保存失败，请检查浏览器存储空间', 'error');
    }
  }, [draft, date, onSaved, saveBodyMetric, saveDailyLog, toast]);

  // 自动保存：输入停止 800ms 后写库
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void persist(), 800);
    return () => clearTimeout(timer);
  }, [draft, persist]);

  // 离开页面前尽力保存一次
  useEffect(() => {
    const onLeave = () => {
      if (dirty.current) void persist();
    };
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onLeave();
    });
    return () => window.removeEventListener('pagehide', onLeave);
  }, [persist]);

  const progress = useMemo(() => dailyProgress(draft), [draft]);
  const sectionLines = useMemo(
    () => new Map(progress.sections.map((s) => [s.key, `${s.filled}/${s.total}`])),
    [progress],
  );

  const statusText =
    status === 'saving'
      ? '正在保存…'
      : status === 'dirty'
        ? '有修改，稍后自动保存'
        : status === 'error'
          ? '保存失败，请重试'
          : lastSavedAt
            ? `已自动保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
            : '填写后会自动保存在本机';

  const training = draft.training ?? {};
  const watch = draft.watch ?? {};
  const sleep = draft.sleep ?? {};
  const body = draft.body ?? {};
  const meals = draft.meals ?? {};
  const supplements = draft.supplements ?? {};

  return (
    <div>
      <Card>
        <div className="row-between">
          <div>
            <div className="small muted">今日总结完成度</div>
            <div className="strong" style={{ fontSize: 22 }}>
              {Math.round(progress.ratio * 100)}%
            </div>
          </div>
          <div className="tiny muted nowrap" data-testid="summary-status">
            {statusText}
          </div>
        </div>
        <div className="bar" style={{ marginTop: 10 }}>
          <i style={{ width: `${Math.max(3, Math.round(progress.ratio * 100))}%` }} />
        </div>
        <div className="wrap" style={{ gap: 6, marginTop: 10 }}>
          {progress.sections.map((s) => (
            <Chip key={s.key} tone={s.filled > 0 ? 'accent' : 'default'}>
              {s.emoji} {s.label.split(' ')[0]} {s.filled}/{s.total}
            </Chip>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <Button block variant="primary" disabled={status === 'saving'} onClick={() => void persist()}>
            保存
          </Button>
          {onExportRequest && (
            <Button block onClick={onExportRequest}>
              导出这一天
            </Button>
          )}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          {onCopyRequest && (
            <Button block onClick={onCopyRequest}>
              复制到其他日期
            </Button>
          )}
          <Button
            block
            variant="danger"
            data-testid="summary-delete"
            onClick={() => setConfirmDelete(true)}
          >
            <IconTrash width={16} height={16} style={{ marginRight: 6 }} />
            删除这一天
          </Button>
        </div>
      </Card>

      {/* 1. 训练记录 */}
      <Collapse
        title="训练记录"
        emoji="🏋️"
        progress={sectionLines.get('training') ?? ''}
        open={open === 'training'}
        onToggle={() => setOpen(open === 'training' ? null : 'training')}
      >
        <Field label="训练类型">
          <Select
            value={training.kind ?? ''}
            onChange={(v) => setSection('training', { kind: (v || null) as SessionKind | null })}
            options={KIND_OPTIONS}
          />
        </Field>
        <Row>
          <div className="grow">
            <Field label="训练项目">
              <TextInput
                value={training.items ?? ''}
                onChange={(v) => setSection('training', { items: v })}
                placeholder="例如：下肢力量 + 爆发力"
                testId="summary-training-items"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="动作 / 组数 / 次数 / 重量">
              <TextArea
                value={training.exercises ?? ''}
                onChange={(v) => setSection('training', { exercises: v })}
                rows={3}
                placeholder="例如：杠铃深蹲 4组×5次 90kg；罗马尼亚硬拉 3组×8次 70kg"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="训练时长（分钟）">
              <NumberInput
                value={training.durationMin ?? null}
                dec={0}
                onChange={(v) => setSection('training', { durationMin: v })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="训练完成度（%）">
              <NumberInput
                value={training.completionPct ?? null}
                dec={0}
                onChange={(v) => setSection('training', { completionPct: v })}
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="跑步距离（km）">
              <NumberInput
                value={training.runDistanceKm ?? null}
                onChange={(v) => setSection('training', { runDistanceKm: v })}
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="跑步配速">
              <TextInput
                value={training.runPaceText ?? ''}
                onChange={(v) => setSection('training', { runPaceText: v })}
                placeholder="5:30/km"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="RPE / 主观强度（1-10）">
              <NumberInput
                value={training.rpe ?? null}
                dec={0}
                onChange={(v) => setSection('training', { rpe: v })}
                testId="summary-rpe"
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="训练容量（kg，可选）">
              <NumberInput
                value={training.volumeKg ?? null}
                dec={0}
                onChange={(v) => setSection('training', { volumeKg: v })}
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="当天训练感受">
              <TextArea
                value={training.feeling ?? ''}
                onChange={(v) => setSection('training', { feeling: v })}
                rows={2}
                placeholder="例如：状态不错，最后一组有点吃力"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="比赛 / 足球训练表现">
              <TextArea
                value={training.matchPerformance ?? ''}
                onChange={(v) => setSection('training', { matchPerformance: v })}
                rows={2}
                placeholder="例如：上场 60 分钟，冲刺 12 次，传接球稳定"
              />
            </Field>
          </div>
        </Row>
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            疼痛 / 不适部位
          </div>
          <div className="wrap" style={{ gap: 6 }}>
            {PAIN_SITES.map((site) => {
              const active = (training.painSites ?? []).includes(site);
              return (
                <button
                  key={site}
                  type="button"
                  className={`chip ${active ? 'red' : ''}`}
                  aria-pressed={active}
                  onClick={() =>
                    setSection('training', {
                      painSites: active
                        ? (training.painSites ?? []).filter((s) => s !== site)
                        : [...(training.painSites ?? []), site],
                    })
                  }
                >
                  {site}
                </button>
              );
            })}
          </div>
        </div>
      </Collapse>

      {/* 2. Apple Watch */}
      <Collapse
        title="Apple Watch 与运动数据"
        emoji="⌚️"
        progress={sectionLines.get('watch') ?? ''}
        open={open === 'watch'}
        onToggle={() => setOpen(open === 'watch' ? null : 'watch')}
      >
        <Row>
          <div className="grow">
            <Field label="活动能量（kcal）">
              <NumberInput value={watch.activeEnergyKcal ?? null} dec={0} onChange={(v) => setSection('watch', { activeEnergyKcal: v })} testId="watch-active" />
            </Field>
          </div>
          <div className="grow">
            <Field label="总消耗（kcal）">
              <NumberInput value={watch.totalEnergyKcal ?? null} dec={0} onChange={(v) => setSection('watch', { totalEnergyKcal: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="步数">
              <NumberInput value={watch.steps ?? null} dec={0} onChange={(v) => setSection('watch', { steps: v })} testId="watch-steps" />
            </Field>
          </div>
          <div className="grow">
            <Field label="运动分钟数">
              <NumberInput value={watch.exerciseMinutes ?? null} dec={0} onChange={(v) => setSection('watch', { exerciseMinutes: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="站立（小时）">
              <NumberInput value={watch.standHours ?? null} dec={0} onChange={(v) => setSection('watch', { standHours: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="平均心率">
              <NumberInput value={watch.avgHr ?? null} dec={0} onChange={(v) => setSection('watch', { avgHr: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="最高心率">
              <NumberInput value={watch.maxHr ?? null} dec={0} onChange={(v) => setSection('watch', { maxHr: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="静息心率">
              <NumberInput value={watch.restingHr ?? null} dec={0} onChange={(v) => setSection('watch', { restingHr: v })} testId="watch-resting-hr" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="移动距离（km）">
              <NumberInput
                value={watch.distanceKm ?? null}
                dec={2}
                onChange={(v) => setSection('watch', { distanceKm: v })}
                testId="watch-distance"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="心率恢复">
              <NumberInput value={watch.hrRecovery ?? null} dec={0} onChange={(v) => setSection('watch', { hrRecovery: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="HRV（ms）">
              <NumberInput value={watch.hrvMs ?? null} dec={0} onChange={(v) => setSection('watch', { hrvMs: v })} testId="watch-hrv" />
            </Field>
          </div>
          <div className="grow">
            <Field label="血氧（%）">
              <NumberInput value={watch.bloodOxygenPct ?? null} dec={0} onChange={(v) => setSection('watch', { bloodOxygenPct: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="备注">
              <TextArea value={watch.note ?? ''} onChange={(v) => setSection('watch', { note: v })} rows={2} placeholder="例如：手表没戴满全天" />
            </Field>
          </div>
        </Row>
        <AttachmentsSection date={date} kind="watch" attachmentIds={draft.attachmentIds ?? []} onChange={(ids) => set('attachmentIds', ids)} />
      </Collapse>

      {/* 3. 睡眠 */}
      <Collapse
        title="睡眠记录"
        emoji="😴"
        progress={sectionLines.get('sleep') ?? ''}
        open={open === 'sleep'}
        onToggle={() => setOpen(open === 'sleep' ? null : 'sleep')}
      >
        <Row>
          <div className="grow">
            <Field label="上床时间">
              <TextInput value={sleep.bedTime ?? ''} onChange={(v) => setSection('sleep', { bedTime: v })} placeholder="23:30" />
            </Field>
          </div>
          <div className="grow">
            <Field label="入睡时间">
              <TextInput value={sleep.sleepTime ?? ''} onChange={(v) => setSection('sleep', { sleepTime: v })} placeholder="23:50" />
            </Field>
          </div>
          <div className="grow">
            <Field label="起床时间">
              <TextInput value={sleep.wakeTime ?? ''} onChange={(v) => setSection('sleep', { wakeTime: v })} placeholder="07:10" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="总睡眠（小时）">
              <NumberInput value={sleep.totalHours ?? null} onChange={(v) => setSection('sleep', { totalHours: v })} testId="sleep-total" />
            </Field>
          </div>
          <div className="grow">
            <Field label="深度睡眠（小时）">
              <NumberInput value={sleep.deepHours ?? null} onChange={(v) => setSection('sleep', { deepHours: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="核心睡眠（小时）">
              <NumberInput value={sleep.coreHours ?? null} onChange={(v) => setSection('sleep', { coreHours: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="REM 睡眠（小时）">
              <NumberInput value={sleep.remHours ?? null} onChange={(v) => setSection('sleep', { remHours: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="夜间清醒（小时）">
              <NumberInput value={sleep.awakeHours ?? null} onChange={(v) => setSection('sleep', { awakeHours: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="午睡（分钟）">
              <NumberInput value={sleep.napMinutes ?? null} dec={0} onChange={(v) => setSection('sleep', { napMinutes: v })} />
            </Field>
          </div>
        </Row>
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            主观睡眠质量
          </div>
          <Scale value={sleep.quality ?? null} onChange={(v) => setSection('sleep', { quality: v })} labels={['很差', '较差', '一般', '不错', '很好']} />
        </div>
        <Row>
          <div className="grow">
            <Field label="睡眠备注">
              <TextArea value={sleep.note ?? ''} onChange={(v) => setSection('sleep', { note: v })} rows={2} placeholder="例如：夜里醒了两次" />
            </Field>
          </div>
        </Row>
        <AttachmentsSection date={date} kind="sleep" attachmentIds={draft.attachmentIds ?? []} onChange={(ids) => set('attachmentIds', ids)} />
      </Collapse>

      {/* 4. 身体与恢复 */}
      <Collapse
        title="身体与恢复状况"
        emoji="🫀"
        progress={sectionLines.get('body') ?? ''}
        open={open === 'body'}
        onToggle={() => setOpen(open === 'body' ? null : 'body')}
      >
        <Row>
          <div className="grow">
            <Field label="体重（kg）">
              <NumberInput value={body.weightKg ?? null} onChange={(v) => setSection('body', { weightKg: v })} testId="body-weight" />
            </Field>
          </div>
          <div className="grow">
            <Field label="体脂率（%）">
              <NumberInput value={body.bodyFatPct ?? null} onChange={(v) => setSection('body', { bodyFatPct: v })} />
            </Field>
          </div>
        </Row>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>疲劳程度</div>
            <Scale value={body.fatigue ?? null} onChange={(v) => setSection('body', { fatigue: v })} />
          </div>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>肌肉酸痛</div>
            <Scale value={body.soreness ?? null} onChange={(v) => setSection('body', { soreness: v })} />
          </div>
        </div>
        <Row>
          <div className="grow">
            <Field
              label="疲劳程度（0~10，报告常用）"
              hint="和上面的 1~5 分制并存：报告里给的是十分制就填这里"
            >
              <NumberInput
                value={body.fatigue10 ?? null}
                dec={1}
                onChange={(v) => setSection('body', { fatigue10: v })}
                testId="body-fatigue10"
              />
            </Field>
          </div>
        </Row>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>精神状态</div>
            <Scale value={body.mood ?? null} onChange={(v) => setSection('body', { mood: v })} />
          </div>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>食欲</div>
            <Scale value={body.appetite ?? null} onChange={(v) => setSection('body', { appetite: v })} />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>压力</div>
            <Scale value={body.stress ?? null} onChange={(v) => setSection('body', { stress: v })} />
          </div>
          <div className="grow">
            <div className="small muted" style={{ marginBottom: 6 }}>恢复情况</div>
            <Scale value={body.recovery ?? null} onChange={(v) => setSection('body', { recovery: v })} />
          </div>
        </div>
        <Row>
          <div className="grow">
            <Field label="伤病或疼痛">
              <TextArea value={body.injuryPain ?? ''} onChange={(v) => setSection('body', { injuryPain: v })} rows={2} placeholder="例如：右膝在深蹲最后两组有轻微不适" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="当天整体感受">
              <TextArea value={body.overall ?? ''} onChange={(v) => setSection('body', { overall: v })} rows={2} testId="body-overall" />
            </Field>
          </div>
        </Row>
      </Collapse>

      {/* 5. 饮食与补剂 */}
      <Collapse
        title="饮食和补剂"
        emoji="🥗"
        progress={sectionLines.get('diet') ?? ''}
        open={open === 'diet'}
        onToggle={() => setOpen(open === 'diet' ? null : 'diet')}
      >
        <Row>
          <div className="grow">
            <Field label="早餐">
              <TextInput value={meals.breakfast ?? ''} onChange={(v) => setSection('meals', { breakfast: v })} placeholder="燕麦 + 鸡蛋" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="午餐">
              <TextInput value={meals.lunch ?? ''} onChange={(v) => setSection('meals', { lunch: v })} placeholder="米饭 + 鸡胸" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="晚餐">
              <TextInput value={meals.dinner ?? ''} onChange={(v) => setSection('meals', { dinner: v })} placeholder="牛肉意面" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="加餐">
              <TextInput value={meals.snack ?? ''} onChange={(v) => setSection('meals', { snack: v })} placeholder="香蕉 + 酸奶" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="饮水量（ml）">
              <NumberInput value={meals.waterMl ?? null} dec={0} onChange={(v) => setSection('meals', { waterMl: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="蛋白粉（g）">
              <NumberInput value={supplements.proteinG ?? null} dec={0} onChange={(v) => setSection('supplements', { proteinG: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="肌酸（g）">
              <NumberInput value={supplements.creatineG ?? null} dec={0} onChange={(v) => setSection('supplements', { creatineG: v })} />
            </Field>
          </div>
          <div className="grow">
            <Field label="咖啡因（mg）">
              <NumberInput value={supplements.caffeineMg ?? null} dec={0} onChange={(v) => setSection('supplements', { caffeineMg: v })} />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="其他补剂">
              <TextInput value={supplements.others ?? ''} onChange={(v) => setSection('supplements', { others: v })} placeholder="例如：维生素 D、镁" />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="补剂备注">
              <TextArea
                value={supplements.note ?? ''}
                onChange={(v) => setSection('supplements', { note: v })}
                rows={2}
                placeholder="例如：训练后一杯蛋白粉，肌酸今天没喝"
                testId="supplements-note"
              />
            </Field>
          </div>
        </Row>
        <Row>
          <div className="grow">
            <Field label="饮食备注">
              <TextArea value={meals.note ?? ''} onChange={(v) => setSection('meals', { note: v })} rows={2} />
            </Field>
          </div>
        </Row>
      </Collapse>

      {/* 6. 自由记录 */}
      <Collapse
        title="当日自由记录"
        emoji="📝"
        progress={sectionLines.get('notes') ?? ''}
        open={open === 'notes'}
        onToggle={() => setOpen(open === 'notes' ? null : 'notes')}
      >
        <Field label="需要告诉 ChatGPT 的内容">
          <TextArea
            value={draft.freeNote ?? ''}
            onChange={(v) => set('freeNote', v)}
            rows={5}
            placeholder="比赛、训练、生活、身体异常，或任何想说明的情况…"
            testId="summary-free-note"
          />
        </Field>
      </Collapse>

      <Confirm
        open={confirmDelete}
        title="删除这一天记录？"
        message={`将删除 ${date} 的今日总结（训练、手表、睡眠、身体、饮食与备注）。训练历史中的训练记录不会被删除。`}
        confirmText="确认删除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteDailyLog(date);
          dirty.current = false;
          setDraft(normalizeDailyLog(null, date));
          setStatus('clean');
          setLastSavedAt(null);
          toast('已删除这一天的记录', 'success');
          onDeleted?.();
        }}
      />
    </div>
  );
}
