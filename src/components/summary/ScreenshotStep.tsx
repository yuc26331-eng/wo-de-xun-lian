// 截图上传 + 真实 OCR 识别（Apple Watch / 健身 / 健康）
//
// 关键行为：
// - 图片先存本机（IndexedDB），识别失败也保留原图，可点击放大
// - 识别成功 = 真的提取到字段；没提取到显示「未识别到有效数据」，不显示"已识别"
// - 目标值（1,232/2,000 千卡）只取实际值；图表坐标/时钟/周月视图不会被当成数据
// - 手动填过的字段不会被「重新识别」悄悄覆盖
// - 单次训练截图只填到它所属的训练卡片；全天活动截图只填全天记录
import { useRef, useState } from 'react';
import type { AttachmentMeta, ISODate, SleepData, TrainingSessionDetail, WatchData } from '../../types';
import { Button, Chip, Field, NumberInput, TextInput, useToast } from '../ui';
import { IconImport } from '../icons';
import { useAppData } from '../../state/AppData';
import { nowISO, uid } from '../../lib/format';
import { recognizeImage, type OcrProgress } from '../../lib/ocr/engine';
import {
  SCREENSHOT_KIND_LABEL,
  WORKOUT_FIELD_LABEL,
  mergeWatchAnalyses,
  parseSleepText,
  parseWatchText,
  sleepDurationText,
  type WatchAnalysis,
  type WorkoutFieldKey,
} from '../../lib/ocr/parse';
import { AttachmentGrid, statusInfo } from './AttachmentGrid';

const MAX_SIZE = 15 * 1024 * 1024;

export interface ScreenshotStepProps {
  date: ISODate;
  kind: 'watch' | 'sleep';
  /** 归属的训练场次：undefined = 全天活动；有值 = 某一次训练 */
  sessionId?: string;
  /** 这张训练卡片的当前内容（避免识别覆盖手填的值） */
  session?: Partial<TrainingSessionDetail>;
  watch?: WatchData;
  sleep?: Partial<SleepData>;
  onWatchChange: (patch: Partial<WatchData>) => void;
  onSleepChange: (patch: Partial<SleepData>) => void;
  /** 单次训练截图解析出的训练字段，回填到这张训练卡片 */
  onWorkoutFields?: (patch: Partial<TrainingSessionDetail>) => void;
  onDirty: () => void;
  compact?: boolean;
}

interface PendingState {
  id: string;
  name: string;
  progress: OcrProgress | null;
  error?: string;
}

const WATCH_FIELDS: { key: keyof WatchData; label: string; unit?: string; dec?: number }[] = [
  { key: 'activeEnergyKcal', label: '活动能量', unit: 'kcal', dec: 0 },
  { key: 'totalEnergyKcal', label: '总消耗', unit: 'kcal', dec: 0 },
  { key: 'exerciseMinutes', label: '运动分钟', unit: '分钟', dec: 0 },
  { key: 'standHours', label: '站立', unit: '小时', dec: 0 },
  { key: 'distanceKm', label: '移动距离', unit: 'km', dec: 2 },
  { key: 'steps', label: '步数', unit: '步', dec: 0 },
  { key: 'avgHr', label: '平均心率', unit: 'bpm', dec: 0 },
  { key: 'maxHr', label: '最高心率', unit: 'bpm', dec: 0 },
  { key: 'restingHr', label: '静息心率', unit: 'bpm', dec: 0 },
  { key: 'hrRecovery', label: '心率恢复', unit: 'bpm', dec: 0 },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', dec: 0 },
  { key: 'bloodOxygenPct', label: '血氧', unit: '%', dec: 0 },
];

const SLEEP_FIELDS: { key: keyof SleepData; label: string; unit?: string }[] = [
  { key: 'totalHours', label: '总睡眠', unit: '小时' },
  { key: 'deepHours', label: '深度睡眠', unit: '小时' },
  { key: 'coreHours', label: '核心睡眠', unit: '小时' },
  { key: 'remHours', label: 'REM', unit: '小时' },
  { key: 'awakeHours', label: '夜间清醒', unit: '小时' },
  { key: 'napMinutes', label: '午睡', unit: '分钟' },
];

const isEmpty = (v: unknown): boolean =>
  v == null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !Number.isFinite(v));

export function ScreenshotStep({
  date,
  kind,
  sessionId,
  session,
  watch,
  sleep,
  onWatchChange,
  onSleepChange,
  onWorkoutFields,
  onDirty,
  compact,
}: ScreenshotStepProps) {
  const { attachments, saveAttachment, deleteAttachment, loadAttachment } = useAppData();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingState[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const shots = attachments
    .filter((a) => {
      if (a.date !== date) return false;
      if (kind === 'sleep') return a.kind === 'sleep';
      if (a.kind !== 'watch') return false;
      const owner = a.sessionId ?? null;
      return sessionId ? owner === sessionId : owner == null;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // 只填空白字段，已有（可能是手动填的）值保持不动
  function applyWatch(patch: Partial<WatchData>): number {
    const next: Partial<WatchData> = {};
    let kept = 0;
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) continue;
      const current = (watch as Record<string, unknown> | undefined)?.[k];
      if (!isEmpty(current)) {
        if (current !== v) kept += 1;
        continue;
      }
      (next as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(next).length) onWatchChange(next);
    return kept;
  }

  function applySleep(patch: Partial<SleepData>): number {
    const next: Partial<SleepData> = {};
    let kept = 0;
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) continue;
      const current = (sleep as Record<string, unknown> | undefined)?.[k];
      if (!isEmpty(current)) {
        if (current !== v) kept += 1;
        continue;
      }
      (next as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(next).length) onSleepChange(next);
    return kept;
  }

  function applyWorkout(analysis: WatchAnalysis, current: Partial<TrainingSessionDetail> = {}): number {
    if (!onWorkoutFields) return 0;
    const patch: Partial<TrainingSessionDetail> = {};
    let kept = 0;
    for (const [k, field] of Object.entries(analysis.workoutFields) as [
      WorkoutFieldKey,
      { value: number | string } | undefined,
    ][]) {
      if (!field) continue;
      const existing = (current as Record<string, unknown>)[k];
      if (!isEmpty(existing)) {
        if (existing !== field.value) kept += 1;
        continue;
      }
      (patch as Record<string, unknown>)[k] = k === 'startTime' ? String(field.value) : field.value;
    }
    if (Object.keys(patch).length) onWorkoutFields(patch);
    return kept;
  }

  async function recognizeFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    const analyses: WatchAnalysis[] = [];
    const localNotes: string[] = [];
    const sleepPatches: Partial<SleepData>[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast('只能上传截图图片', 'error');
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast(`${file.name} 超过 15MB，请先压缩`, 'error');
        continue;
      }
      const id = uid('att');
      const baseMeta: AttachmentMeta = {
        id,
        date,
        kind,
        sessionId: sessionId ?? null,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: nowISO(),
        ocrStatus: 'pending',
      };
      // 1) 先保存原图：识别失败也不会丢
      await saveAttachment(baseMeta, file);
      onDirty();
      setPending((prev) => [...prev, { id, name: file.name, progress: null }]);

      try {
        const text = await recognizeImage(file, (p) => {
          setPending((prev) => prev.map((x) => (x.id === id ? { ...x, progress: p } : x)));
        });

        if (kind === 'sleep') {
          const parsed = parseSleepText(text);
          const wrongType = parsed.status === 'empty';
          const status = parsed.status === 'empty' ? 'empty' : parsed.status === 'partial' ? 'partial' : 'done';
          await saveAttachment(
            {
              ...baseMeta,
              ocrKind: 'sleep',
              ocrStatus: status,
              ocrText: text.slice(0, 6000),
              ocrFields: Object.fromEntries(
                Object.entries(parsed.sleep).map(([k, v]) => [k, v == null ? null : String(v)]),
              ),
              ocrPending: parsed.pendingFields,
              ocrNote: parsed.warnings[0] ?? parsed.hints[0],
              ocrAt: nowISO(),
            },
            file,
          );
          localNotes.push(...parsed.hints, ...parsed.warnings);
          if (!wrongType) sleepPatches.push(parsed.sleep);
        } else {
          const analysis = parseWatchText(text);
          await saveAttachment(
            {
              ...baseMeta,
              ocrKind: analysis.kind,
              ocrStatus:
                analysis.status === 'ok' ? 'done' : analysis.status === 'partial' ? 'partial' : 'empty',
              ocrText: text.slice(0, 6000),
              ocrFields: Object.fromEntries(
                Object.entries(analysis.fields).map(([k, v]) => [k, v?.value ?? null]),
              ),
              ocrPending: analysis.pendingFields,
              ocrNote: analysis.warnings[0] ?? analysis.hints[0],
              ocrAt: nowISO(),
            },
            file,
          );
          localNotes.push(...analysis.hints, ...analysis.warnings);

          // 归属判断：全天活动截图只做全天记录，单次训练截图只做这一场训练
          if (analysis.kind === 'workout' && !sid()) {
            localNotes.push(
              `《${file.name}》看起来是单次训练截图：请在对应的训练卡片里点「添加训练截图」，这样只会算到那一次训练`,
            );
          } else if (analysis.kind === 'activity' && sid()) {
            localNotes.push(
              `《${file.name}》是全天活动截图：它会包含多场训练，建议放在「Apple Watch 运动数据」这一步，不要算进单次训练`,
            );
          } else if (analysis.kind === 'sleep') {
            localNotes.push(`《${file.name}》看起来是睡眠截图，请到「睡眠记录」步骤上传`);
          } else if (analysis.status !== 'empty') {
            analyses.push(analysis);
          }
        }
      } catch (err) {
        console.error('[ocr] 识别失败', err);
        localNotes.push(`${file.name}：识别失败（原图已保存），可以点 ↻ 重试或手动填写`);
        await saveAttachment({ ...baseMeta, ocrStatus: 'failed', ocrNote: '识别失败，可重试' }, file);
        setPending((prev) =>
          prev.map((x) => (x.id === id ? { ...x, error: '识别失败，可重试' } : x)),
        );
      } finally {
        setPending((prev) => prev.filter((x) => x.id !== id));
      }
    }

    let keptCount = 0;
    if (kind === 'watch' && analyses.length) {
      const merged = mergeWatchAnalyses(analyses);
      const workoutNote: string[] = [];
      for (const a of analyses) {
        if (a.kind === 'workout') keptCount += applyWorkout(a, session ?? {});
      }
      const activityPatch: Partial<WatchData> = {};
      for (const [k, v] of Object.entries(merged.merged) as [keyof WatchData, number][]) {
        activityPatch[k] = v as never;
      }
      if (Object.keys(activityPatch).length) keptCount += applyWatch(activityPatch);
      localNotes.push(...merged.notes, ...workoutNote);
    } else if (kind === 'sleep' && sleepPatches.length) {
      const mergedSleep: Partial<SleepData> = {};
      for (const patch of sleepPatches) {
        for (const [k, v] of Object.entries(patch)) {
          if (v == null) continue;
          if ((mergedSleep as Record<string, unknown>)[k] == null) {
            (mergedSleep as Record<string, unknown>)[k] = v;
          }
        }
      }
      keptCount += applySleep(mergedSleep);
    }
    if (keptCount > 0) {
      localNotes.push(`已保留你手动填写的 ${keptCount} 项（重新识别不会覆盖手改的值）`);
    }
    setNotes([...new Set(localNotes)]);
    setBusy(false);
    onDirty();
  }

  function sid(): string | undefined {
    return sessionId;
  }

  /** 对已保存的截图重新识别（不覆盖手改字段） */
  async function retry(shot: AttachmentMeta) {
    const blob = await loadAttachment(shot.id);
    if (!blob) {
      toast('找不到原图，请重新上传', 'error');
      return;
    }
    const file = new File([blob], shot.name, { type: shot.type });
    setBusy(true);
    setPending([{ id: shot.id, name: shot.name, progress: null }]);
    try {
      const text = await recognizeImage(file, (p) => {
        setPending([{ id: shot.id, name: shot.name, progress: p }]);
      });
      if (kind === 'sleep') {
        const parsed = parseSleepText(text);
        const kept = applySleep(parsed.sleep);
        await saveAttachment(
          {
            ...shot,
            ocrKind: 'sleep',
            ocrStatus:
              parsed.status === 'ok' ? 'done' : parsed.status === 'partial' ? 'partial' : 'empty',
            ocrText: text.slice(0, 6000),
            ocrFields: Object.fromEntries(
              Object.entries(parsed.sleep).map(([k, v]) => [k, v == null ? null : String(v)]),
            ),
            ocrPending: parsed.pendingFields,
            ocrNote: parsed.warnings[0] ?? parsed.hints[0],
            ocrAt: nowISO(),
          },
          blob,
        );
        setNotes([...parsed.hints, ...parsed.warnings, ...(kept ? [`已保留手填的 ${kept} 项`] : [])]);
      } else {
        const analysis = parseWatchText(text);
        let kept = 0;
        if (analysis.kind === 'workout' && sessionId) {
          kept = applyWorkout(analysis, session ?? {});
        } else if (analysis.kind === 'activity' && !sessionId) {
          const patch: Partial<WatchData> = {};
          for (const [k, v] of Object.entries(analysis.fields) as [
            keyof WatchData,
            { value: number } | undefined,
          ][]) {
            if (v) patch[k] = v.value as never;
          }
          kept = applyWatch(patch);
        }
        await saveAttachment(
          {
            ...shot,
            ocrKind: analysis.kind,
            ocrStatus:
              analysis.status === 'ok' ? 'done' : analysis.status === 'partial' ? 'partial' : 'empty',
            ocrText: text.slice(0, 6000),
            ocrFields: Object.fromEntries(
              Object.entries(analysis.fields).map(([k, v]) => [k, v?.value ?? null]),
            ),
            ocrPending: analysis.pendingFields,
            ocrNote: analysis.warnings[0] ?? analysis.hints[0],
            ocrAt: nowISO(),
          },
          blob,
        );
        setNotes([
          ...analysis.hints,
          ...analysis.warnings,
          ...(kept ? [`已保留手填的 ${kept} 项`] : []),
        ]);
      }
      toast('识别完成，请核对结果', 'success');
    } catch (err) {
      console.error(err);
      toast('识别失败，可以再试一次或手动填写', 'error');
    } finally {
      setPending([]);
      setBusy(false);
      onDirty();
    }
  }

  const fields = kind === 'watch' ? WATCH_FIELDS : SLEEP_FIELDS;
  const readValue = (key: string): number | null => {
    const source = (kind === 'watch' ? watch : sleep) as Record<string, unknown> | undefined;
    const v = source?.[key];
    return typeof v === 'number' ? v : null;
  };
  const writeValue = (key: string, value: number | null) => {
    if (kind === 'watch') onWatchChange({ [key]: value } as Partial<WatchData>);
    else onSleepChange({ [key]: value } as Partial<SleepData>);
    onDirty();
  };

  const recognizedCount = fields.filter((f) => readValue(f.key as string) != null).length;
  const pendingNames = [...new Set(shots.flatMap((s) => s.ocrPending ?? []))];
  const emptyShots = shots.filter((s) => s.ocrStatus === 'empty' || s.ocrStatus === 'failed');

  return (
    <div data-testid={sessionId ? `screenshot-step-session-${sessionId}` : `screenshot-step-${kind}`}>
      <div className="col" style={{ gap: 10 }}>
        <Button
          block
          size={compact ? 'md' : 'lg'}
          variant="primary"
          disabled={busy}
          data-testid={sessionId ? `ocr-upload-session-${sessionId}` : `ocr-upload-${kind}`}
          onClick={() => inputRef.current?.click()}
        >
          <IconImport width={18} height={18} style={{ marginRight: 6 }} />
          {busy
            ? '正在识别…'
            : kind === 'sleep'
              ? '上传睡眠截图'
              : sessionId
                ? '添加训练截图'
                : '上传全天活动截图（可多张）'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          data-testid={sessionId ? `ocr-input-session-${sessionId}` : `ocr-input-${kind}`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void recognizeFiles(files);
          }}
        />
        {!compact && (
          <div className="tiny muted">
            识别全部在这台设备本机完成，图片不会上传；首次识别需要加载模型（约 12MB），之后可离线使用。
            没有识别到的项目会留空，不会编造数值。
          </div>
        )}
      </div>

      {pending.map((p) => (
        <div key={p.id} className="ocr-progress" data-testid="ocr-progress">
          <div className="row-between">
            <span className="small truncate">{p.name}</span>
            <span className="tiny muted">
              {p.error ?? p.progress?.message ?? '准备中'} {Math.round((p.progress?.progress ?? 0) * 100)}%
            </span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <i style={{ width: `${Math.max(4, Math.round((p.progress?.progress ?? 0) * 100))}%` }} />
          </div>
        </div>
      ))}

      <AttachmentGrid
        attachments={shots}
        onRetry={(shot) => void retry(shot)}
        onDelete={async (shot) => {
          await deleteAttachment(shot.id);
          onDirty();
        }}
        labelOf={(shot) =>
          shot.ocrKind ? SCREENSHOT_KIND_LABEL[shot.ocrKind] : undefined
        }
        emptyHint={compact ? undefined : '原图会保存在本机，识别失败也不会丢'}
      />

      {shots.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {shots.map((shot) => {
            const info = statusInfo(shot);
            return (
              <span
                key={shot.id}
                className={`chip ${info.cls === 'done' ? 'green' : info.cls === 'partial' ? 'orange' : 'red'}`}
              >
                {shot.ocrKind === 'workout' ? '单次训练' : shot.ocrKind === 'activity' ? '全天活动' : ''}
                {shot.ocrKind === 'sleep' ? '睡眠' : ''} {info.text}
              </span>
            );
          })}
        </div>
      )}

      {pendingNames.length > 0 && (
        <div className="chip orange" style={{ marginTop: 10, whiteSpace: 'normal' }} data-testid="ocr-pending">
          待确认：{pendingNames.join('、')}。这些字段是从有歧义的排版里读出来的，请核对后再保存。
        </div>
      )}

      {notes.length > 0 && (
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          {notes.map((n) => (
            <div key={n} className="chip orange" style={{ whiteSpace: 'normal' }}>
              {n}
            </div>
          ))}
        </div>
      )}

      <div className="divider" />
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="strong" style={{ fontSize: 15 }}>
          识别结果（可直接修改）
        </span>
        <Chip tone={recognizedCount ? 'green' : 'default'}>
          {recognizedCount ? `已填 ${recognizedCount} 项` : '暂无数据'}
        </Chip>
      </div>
      {emptyShots.length > 0 && recognizedCount === 0 && (
        <div className="tiny muted" style={{ marginBottom: 8 }}>
          已经保存了原图，但没有提取到可用数值：可以点 ↻ 重新识别，或直接手动填写（不填也能继续）。
        </div>
      )}
      <div className="ocr-grid">
        {fields.map((f) => (
          <Field key={f.key as string} label={`${f.label}${f.unit ? `（${f.unit}）` : ''}`}>
            <NumberInput
              value={readValue(f.key as string)}
              dec={kind === 'watch' ? ((f as { dec?: number }).dec ?? 0) : 2}
              testId={sessionId ? `ocr-field-session-${sessionId}-${String(f.key)}` : `ocr-field-${kind}-${String(f.key)}`}
              onChange={(v) => writeValue(f.key as string, v)}
            />
          </Field>
        ))}
      </div>
      {kind === 'sleep' && (
        <>
          <div className="tiny muted" style={{ marginTop: 6 }} data-testid="sleep-duration-text">
            {sleep?.totalHours != null
              ? `睡眠时长：${sleepDurationText(sleep.totalHours)}`
              : '睡眠时长：未填写（识别不到就留空，不猜数值）'}
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <div className="grow">
              <Field label="入睡时间">
                <TextInput
                  value={sleep?.sleepTime ?? ''}
                  onChange={(v) => {
                    onSleepChange({ sleepTime: v });
                    onDirty();
                  }}
                  placeholder="23:30"
                  testId="ocr-field-sleep-sleepTime"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="起床时间">
                <TextInput
                  value={sleep?.wakeTime ?? ''}
                  onChange={(v) => {
                    onSleepChange({ wakeTime: v });
                    onDirty();
                  }}
                  placeholder="07:10"
                  testId="ocr-field-sleep-wakeTime"
                />
              </Field>
            </div>
          </div>
        </>
      )}
      {kind === 'watch' && !sessionId && (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          这里填的是全天数据（例如「健身」摘要里的活动能量 / 锻炼 / 站立 / 步数）。
          单次训练的能量请在训练卡片里单独记录，避免和全天数据重复相加。
        </div>
      )}
      {kind === 'watch' && sessionId && onWorkoutFields && (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          训练截图里的体能训练时间、动态/总千卡、距离、平均心率会填到这张训练卡片；
          全天活动截图不要放到这里。
        </div>
      )}
      {kind === 'watch' && (
        <div className="tiny muted" style={{ marginTop: 4 }}>
          支持的类型：{WORKOUT_FIELD_LABEL.durationMin} 等体能训练详情、健身摘要圆环、活动详情、健康睡眠日视图。
        </div>
      )}
    </div>
  );
}
