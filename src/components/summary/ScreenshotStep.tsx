/**
 * 截图上传 + 真实 OCR 识别（Apple Watch / 睡眠）
 * - 图片与识别结果都存进 IndexedDB（刷新、退出后仍在，可继续）
 * - 识别不到不编造：保留图片并允许重试或手动填写
 * - 多张截图合并时同一天的同名指标取最大值，重复截图会被识别出来不重复计算
 */
import { useEffect, useRef, useState } from 'react';
import type { AttachmentMeta, ISODate, SleepData, WatchData } from '../../types';
import { Button, Chip, Field, NumberInput, TextInput, useToast } from '../ui';
import { IconImport, IconTrash } from '../icons';
import { useAppData } from '../../state/AppData';
import { nowISO, uid } from '../../lib/format';
import { recognizeImage, type OcrProgress } from '../../lib/ocr/engine';
import {
  mergeWatchAnalyses,
  parseSleepText,
  parseWatchText,
  type WatchAnalysis,
} from '../../lib/ocr/parse';

const MAX_SIZE = 15 * 1024 * 1024;

export interface ScreenshotStepProps {
  date: ISODate;
  kind: 'watch' | 'sleep';
  /** 当前已合并的结果（用于展示与手动纠错） */
  watch?: WatchData;
  sleep?: Partial<SleepData>;
  onWatchChange: (patch: Partial<WatchData>) => void;
  onSleepChange: (patch: Partial<SleepData>) => void;
  /** 图片或识别结果变化后触发草稿保存 */
  onDirty: () => void;
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

export function ScreenshotStep({
  date,
  kind,
  watch,
  sleep,
  onWatchChange,
  onSleepChange,
  onDirty,
}: ScreenshotStepProps) {
  const { attachments, saveAttachment, deleteAttachment, loadAttachment } = useAppData();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingState[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const shots = attachments
    .filter((a) => a.date === date && a.kind === kind)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // 缩略图（object URL 在卸载时释放）
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const shot of shots) {
        const blob = await loadAttachment(shot.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[shot.id] = url;
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots.map((s) => s.id).join('|')]);

  /** 对一批图片做识别，并把结果写回附件 + 合并结果 */
  async function recognizeFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    const analyses: WatchAnalysis[] = [];
    const sleepResults: { sleep: Partial<SleepData>; warnings: string[] }[] = [];
    const localNotes: string[] = [];

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
      const meta: AttachmentMeta = {
        id,
        date,
        kind,
        name: file.name,
        type: file.type,
        size: file.size,
        createdAt: nowISO(),
        ocrStatus: 'pending',
      };
      // 1) 先保存图片（即使识别失败也不会丢）
      await saveAttachment(meta, file);
      onDirty();
      setPending((prev) => [...prev, { id, name: file.name, progress: null }]);

      try {
        const text = await recognizeImage(file, (p) => {
          setPending((prev) => prev.map((x) => (x.id === id ? { ...x, progress: p } : x)));
        });
        if (kind === 'watch') {
          const analysis = parseWatchText(text);
          analyses.push(analysis);
          localNotes.push(...analysis.hints, ...analysis.warnings);
          await saveAttachment(
            {
              ...meta,
              ocrStatus: analysis.warnings.length && !Object.keys(analysis.fields).length ? 'failed' : 'done',
              ocrText: text.slice(0, 4000),
              ocrFields: Object.fromEntries(
                Object.entries(analysis.fields).map(([k, v]) => [k, v?.value ?? null]),
              ),
              ocrAt: nowISO(),
            },
            file,
          );
        } else {
          const parsed = parseSleepText(text);
          sleepResults.push({ sleep: parsed.sleep, warnings: parsed.warnings });
          localNotes.push(...parsed.hints, ...parsed.warnings);
          await saveAttachment(
            {
              ...meta,
              ocrStatus: Object.keys(parsed.sleep).length ? 'done' : 'failed',
              ocrText: text.slice(0, 4000),
              ocrFields: Object.fromEntries(
                Object.entries(parsed.sleep).map(([k, v]) => [k, v == null ? null : String(v)]),
              ),
              ocrAt: nowISO(),
            },
            file,
          );
        }
      } catch (err) {
        console.error('[ocr] 识别失败', err);
        localNotes.push(`${file.name}：识别失败，可以重试或手动填写`);
        await saveAttachment({ ...meta, ocrStatus: 'failed' }, file);
        setPending((prev) =>
          prev.map((x) => (x.id === id ? { ...x, error: '识别失败，可重试' } : x)),
        );
      } finally {
        setPending((prev) => prev.filter((x) => x.id !== id));
      }
    }

    if (kind === 'watch' && analyses.length) {
      const merged = mergeWatchAnalyses(analyses);
      onWatchChange(merged.merged);
      setNotes([...merged.notes, ...localNotes]);
    } else if (kind === 'sleep' && sleepResults.length) {
      const merged: Partial<SleepData> = {};
      for (const r of sleepResults) {
        for (const [k, v] of Object.entries(r.sleep)) {
          if (v == null) continue;
          if ((merged as Record<string, unknown>)[k] == null) {
            (merged as Record<string, unknown>)[k] = v;
          }
        }
      }
      onSleepChange(merged);
      setNotes([...sleepResults.flatMap((r) => r.warnings), ...localNotes]);
    } else if (localNotes.length) {
      setNotes(localNotes);
    }
    setBusy(false);
    onDirty();
  }

  /** 对已保存的截图重新识别 */
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
      if (kind === 'watch') {
        const analysis = parseWatchText(text);
        onWatchChange(analysis.fields ? Object.fromEntries(
          Object.entries(analysis.fields).map(([k, v]) => [k, v?.value ?? null]),
        ) : {});
        setNotes([...analysis.hints, ...analysis.warnings]);
        await saveAttachment(
          {
            ...shot,
            ocrStatus: Object.keys(analysis.fields).length ? 'done' : 'failed',
            ocrText: text.slice(0, 4000),
            ocrFields: Object.fromEntries(
              Object.entries(analysis.fields).map(([k, v]) => [k, v?.value ?? null]),
            ),
            ocrAt: nowISO(),
          },
          blob,
        );
      } else {
        const parsed = parseSleepText(text);
        onSleepChange(parsed.sleep);
        setNotes([...parsed.hints, ...parsed.warnings]);
        await saveAttachment(
          {
            ...shot,
            ocrStatus: Object.keys(parsed.sleep).length ? 'done' : 'failed',
            ocrText: text.slice(0, 4000),
            ocrFields: Object.fromEntries(
              Object.entries(parsed.sleep).map(([k, v]) => [k, v == null ? null : String(v)]),
            ),
            ocrAt: nowISO(),
          },
          blob,
        );
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

  return (
    <div>
      <div className="col" style={{ gap: 10 }}>
        <Button
          block
          size="lg"
          variant="primary"
          disabled={busy}
          data-testid={`ocr-upload-${kind}`}
          onClick={() => inputRef.current?.click()}
        >
          <IconImport width={18} height={18} style={{ marginRight: 6 }} />
          {busy ? '正在识别…' : kind === 'watch' ? '上传手表截图（可多张）' : '上传睡眠截图'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          data-testid={`ocr-input-${kind}`}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void recognizeFiles(files);
          }}
        />
        <div className="tiny muted">
          识别全部在本机完成，图片不会上传；首次识别需要加载模型（约 12MB），之后可离线使用。
        </div>
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

      {shots.length > 0 && (
        <div className="attach-grid" style={{ marginTop: 10 }}>
          {shots.map((shot) => (
            <div key={shot.id} className="attach-item">
              {thumbs[shot.id] ? (
                <img src={thumbs[shot.id]} alt={shot.name} />
              ) : (
                <div className="attach-placeholder">加载中…</div>
              )}
              <div className={`ocr-badge ${shot.ocrStatus ?? 'pending'}`}>
                {shot.ocrStatus === 'done' ? '已识别' : shot.ocrStatus === 'failed' ? '未识别' : '识别中'}
              </div>
              <div className="attach-actions">
                <button
                  aria-label="重新识别"
                  data-testid={`ocr-retry-${shot.id}`}
                  onClick={() => void retry(shot)}
                >
                  ↻
                </button>
                <button
                  aria-label="删除截图"
                  className="danger"
                  onClick={async () => {
                    await deleteAttachment(shot.id);
                    onDirty();
                  }}
                >
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          {[...new Set(notes)].map((n) => (
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
      <div className="ocr-grid">
        {fields.map((f) => (
          <Field key={f.key as string} label={`${f.label}${f.unit ? `（${f.unit}）` : ''}`}>
            <NumberInput
              value={readValue(f.key as string)}
              dec={kind === 'watch' ? (f as { dec?: number }).dec ?? 0 : 1}
              testId={`ocr-field-${kind}-${String(f.key)}`}
              onChange={(v) => writeValue(f.key as string, v)}
            />
          </Field>
        ))}
      </div>
      {kind === 'sleep' && (
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
      )}
      <div className="tiny muted" style={{ marginTop: 10 }}>
        {kind === 'watch'
          ? '多张截图会合并计算：同一天的同名指标取最大值，不会把同一次训练重复累加。识别不到的项留空，可直接手动填写。'
          : '睡眠截图会自动带出总时长与各阶段；已经填过的内容不会被覆盖为空值。'}
      </div>
    </div>
  );
}
