// 一天可以记录多次训练：每次训练一张卡片
// - 每张卡片独立记录 训练项目 / 开始时间 / 时长 / 训练内容 / 记录方式 / 训练感受
// - 选了「Apple Watch 已记录」可以上传本次训练的截图，识别结果只归属这一场
// - 选了「未记录」可以只用文字描述，不要求补手表数据
// - 旧版只有「训练次数 + 逗号时长」的记录原样保留，不会自动拆分或丢失
import { useState } from 'react';
import type { ISODate, SessionKind, TrainingSection, TrainingSessionDetail, WatchData } from '../../types';
import { SESSION_KIND_LABEL } from '../../types';
import { Button, Field, NumberInput, Segmented, TextArea, TextInput, useToast } from '../ui';
import { IconTrash } from '../icons';
import { uid } from '../../lib/format';
import { useAppData } from '../../state/AppData';
import { ScreenshotStep } from './ScreenshotStep';

export interface TrainingSessionsCardProps {
  date: ISODate;
  training: TrainingSection | undefined;
  /** 记录本次训练字段变化（会与已有内容合并） */
  onChange: (patch: Partial<TrainingSection>) => void;
  onDirty: () => void;
}

const KINDS: SessionKind[] = [
  'strength',
  'run',
  'ride',
  'football',
  'stretch',
  'recovery',
  'other',
];

const newSession = (kind?: SessionKind | null): TrainingSessionDetail => ({
  id: uid('sess'),
  name: '',
  kind: kind ?? 'strength',
  startTime: '',
  durationMin: null,
  note: '',
  watchRecorded: false,
  feel: '',
});

export function TrainingSessionsCard({
  date,
  training,
  onChange,
  onDirty,
}: TrainingSessionsCardProps) {
  const { attachments, deleteAttachment } = useAppData();
  const toast = useToast();
  const sessions = training?.sessions ?? [];
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removingSession, setRemovingSession] = useState<string | null>(null);
  const [showLegacy, setShowLegacy] = useState(true);

  const legacyCount = training?.sessionCount ?? null;
  const legacyDurations = training?.sessionDurationsMin ?? [];
  const hasLegacy =
    sessions.length === 0 &&
    ((legacyCount ?? 0) > 1 || legacyDurations.length > 1 || Boolean(training?.items));

  const patchSession = (id: string, patch: Partial<TrainingSessionDetail>) => {
    const next = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
    onChange({ sessions: next, sessionCount: next.length });
  };

  const addSession = () => {
    const next = [...sessions, newSession(training?.kind ?? 'strength')];
    onChange({ sessions: next, sessionCount: next.length, restDay: false });
    onDirty();
  };

  const removeSession = async (id: string) => {
    if (removingSession) return;
    setRemovingSession(id);
    try {
      // 截图二进制独立保存在 attachments store；删卡片时必须按 sessionId
      // 一并删除，否则会留下界面再也访问不到的孤儿数据。
      const owned = attachments.filter((attachment) => attachment.sessionId === id);
      await Promise.all(owned.map((attachment) => deleteAttachment(attachment.id)));

      const next = sessions.filter((s) => s.id !== id);
      onChange({ sessions: next, sessionCount: next.length || null });
      setConfirmRemove(null);
      onDirty();
    } catch (err) {
      console.error('[summary] 删除训练场次失败', err);
      toast('删除失败，请重试', 'error');
    } finally {
      setRemovingSession(null);
    }
  };

  /** 旧记录 → 训练卡片：把原文完整保留到每张卡片的训练内容里 */
  const convertLegacy = () => {
    const durations = legacyDurations.filter((d): d is number => typeof d === 'number' && d > 0);
    const source = [training?.items, training?.exercises].filter(Boolean).join('｜');
    const count = Math.max(durations.length, legacyCount ?? 1, 1);
    const next: TrainingSessionDetail[] = Array.from({ length: count }, (_, i) => ({
      id: uid('sess'),
      name: i === 0 && training?.items ? String(training.items).slice(0, 40) : `第 ${i + 1} 次训练`,
      kind: training?.kind ?? 'strength',
      startTime: '',
      durationMin: durations[i] ?? null,
      note: source,
      watchRecorded: false,
      feel: '',
    }));
    onChange({ sessions: next, sessionCount: next.length });
    setShowLegacy(false);
  };

  return (
    <div>
      {hasLegacy && showLegacy && (
        <div className="chip orange" style={{ whiteSpace: 'normal', marginBottom: 10 }}>
          这一天已有旧版记录（训练次数 {legacyCount ?? 1}
          {legacyDurations.length ? `，时长 ${legacyDurations.join(' / ')} 分钟` : ''}）。
          旧内容会原样保留；需要按次数分别记录时，可以
          <button className="link" style={{ marginLeft: 4 }} onClick={convertLegacy}>
            转为训练卡片
          </button>
          （原文会完整保留在每张卡片的训练内容里，不会丢）。
        </div>
      )}

      {sessions.map((s, index) => {
        const watch = s.watch ?? {};
        const setWatch = (patch: Partial<WatchData>) =>
          patchSession(s.id ?? String(index), { watch: { ...watch, ...patch } });
        return (
          <div className="session-card" key={s.id ?? index} data-testid={`session-card-${index}`}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="strong" style={{ fontSize: 15 }}>
                第 {index + 1} 次训练
                {s.startTime ? ` · ${s.startTime}` : ''}
              </span>
              <button
                className="icon-btn danger"
                aria-label={`删除第 ${index + 1} 次训练`}
                data-testid={`session-remove-${index}`}
                onClick={() => setConfirmRemove(s.id ?? String(index))}
              >
                <IconTrash width={15} height={15} />
              </button>
            </div>

            {confirmRemove === (s.id ?? String(index)) && (
              <div className="chip red" style={{ whiteSpace: 'normal', marginBottom: 8 }}>
                删除「{s.name || `第 ${index + 1} 次训练`}」这次记录？截图和识别结果也会一起移除。
                <button
                  className="link"
                  style={{ marginLeft: 6 }}
                  data-testid={`session-remove-confirm-${index}`}
                  disabled={removingSession === (s.id ?? String(index))}
                  onClick={() => void removeSession(s.id ?? String(index))}
                >
                  {removingSession === (s.id ?? String(index)) ? '正在删除…' : '确认删除'}
                </button>
                <button className="link" style={{ marginLeft: 6 }} onClick={() => setConfirmRemove(null)}>
                  取消
                </button>
              </div>
            )}

            <div className="form-row">
              <div className="grow">
                <Field label="训练项目">
                  <TextInput
                    value={s.name}
                    onChange={(v) => {
                      patchSession(s.id ?? String(index), { name: v });
                      onDirty();
                    }}
                    placeholder="例如：上肢力量 / 足球比赛"
                    testId={`session-name-${index}`}
                  />
                </Field>
              </div>
              <div className="grow">
                <Field label="类型">
                  <select
                    className="input"
                    value={s.kind ?? 'other'}
                    data-testid={`session-kind-${index}`}
                    onChange={(e) => {
                      patchSession(s.id ?? String(index), { kind: e.target.value as SessionKind });
                      onDirty();
                    }}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {SESSION_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="form-row">
              <div className="grow">
                <Field label="开始时间">
                  <TextInput
                    value={s.startTime ?? ''}
                    onChange={(v) => {
                      patchSession(s.id ?? String(index), { startTime: v });
                      onDirty();
                    }}
                    placeholder="09:00"
                    testId={`session-start-${index}`}
                  />
                </Field>
              </div>
              <div className="grow">
                <Field label="时长（分钟）">
                  <NumberInput
                    value={s.durationMin ?? null}
                    dec={0}
                    testId={`session-duration-${index}`}
                    onChange={(v) => {
                      patchSession(s.id ?? String(index), { durationMin: v });
                      onDirty();
                    }}
                  />
                </Field>
              </div>
            </div>

            <Field label="训练内容">
              <TextArea
                value={s.note ?? ''}
                onChange={(v) => {
                  patchSession(s.id ?? String(index), { note: v });
                  onDirty();
                }}
                rows={2}
                placeholder="例如：深蹲 5 组、核心 4 组；或 5v5 对抗 4 节"
                testId={`session-note-${index}`}
              />
            </Field>

            <div style={{ marginTop: 10 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                这次训练有没有用 Apple Watch 记录？
              </div>
              <Segmented<'yes' | 'no'>
                value={s.watchRecorded ? 'yes' : 'no'}
                onChange={(v) => {
                  patchSession(s.id ?? String(index), { watchRecorded: v === 'yes' });
                  onDirty();
                }}
                options={[
                  { value: 'yes', label: 'Apple Watch 已记录' },
                  { value: 'no', label: '未记录' },
                ]}
              />
            </div>

            {s.watchRecorded ? (
              <div style={{ marginTop: 10 }}>
                <ScreenshotStep
                  date={date}
                  kind="watch"
                  sessionId={s.id ?? String(index)}
                  session={s}
                  watch={watch}
                  onWatchChange={setWatch}
                  onSleepChange={() => {}}
                  onWorkoutFields={(patch) => {
                    patchSession(s.id ?? String(index), patch);
                    onDirty();
                  }}
                  onDirty={onDirty}
                  compact
                />
                <div className="form-row" style={{ marginTop: 8 }}>
                  <div className="grow">
                    <Field label="动态消耗（千卡）">
                      <NumberInput
                        value={s.kcal ?? null}
                        dec={0}
                        testId={`session-kcal-${index}`}
                        onChange={(v) => {
                          patchSession(s.id ?? String(index), { kcal: v });
                          onDirty();
                        }}
                      />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="总消耗（千卡）">
                      <NumberInput
                        value={s.totalKcal ?? null}
                        dec={0}
                        onChange={(v) => {
                          patchSession(s.id ?? String(index), { totalKcal: v });
                          onDirty();
                        }}
                      />
                    </Field>
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <div className="grow">
                    <Field label="平均心率">
                      <NumberInput
                        value={s.avgHr ?? null}
                        dec={0}
                        testId={`session-avghr-${index}`}
                        onChange={(v) => {
                          patchSession(s.id ?? String(index), { avgHr: v });
                          onDirty();
                        }}
                      />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="距离（km）">
                      <NumberInput
                        value={s.distanceKm ?? null}
                        dec={2}
                        onChange={(v) => {
                          patchSession(s.id ?? String(index), { distanceKm: v });
                          onDirty();
                        }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div className="tiny muted" style={{ marginBottom: 8 }}>
                  没戴手表也没关系，用文字描述这次训练就够了；缺失的数据不会当成 0，也不会虚构消耗。
                </div>
                <Field label="训练 / 比赛描述（可不填）">
                  <TextArea
                    value={s.note ?? ''}
                    onChange={(v) => {
                      patchSession(s.id ?? String(index), { note: v });
                      onDirty();
                    }}
                    rows={2}
                    placeholder="例如：今晚踢了 60 分钟比赛，对抗比较多"
                    testId={`session-desc-${index}`}
                  />
                </Field>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <Field label="本次训练感受">
                <TextArea
                  value={s.feel ?? ''}
                  onChange={(v) => {
                    patchSession(s.id ?? String(index), { feel: v });
                    onDirty();
                  }}
                  rows={2}
                  placeholder="例如：下半场腿沉，最后 10 分钟顶不住；比赛表现一般"
                  testId={`session-feel-${index}`}
                />
              </Field>
            </div>
          </div>
        );
      })}

      <Button
        block
        size={sessions.length ? 'md' : 'lg'}
        variant={sessions.length ? 'default' : 'primary'}
        data-testid="session-add"
        onClick={addSession}
        style={{ marginTop: sessions.length ? 10 : 0 }}
      >
        ＋ 添加一次训练
      </Button>
      {sessions.length > 0 && (
        <div className="tiny muted" style={{ marginTop: 8 }} data-testid="session-count">
          今天共 {sessions.length} 次训练（训练次数按卡片自动统计，不用手填数字）
        </div>
      )}
    </div>
  );
}
