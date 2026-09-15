/**
 * 历史训练
 * 全部训练记录 / 按月分组 / 搜索筛选 / 详情 / 导出中文 PDF
 */
import { useMemo, useState } from 'react';
import { Page } from '../components/Page';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  ListRow,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  Field,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { IconShare, IconTrash } from '../components/icons';
import { exportSummaryPdf } from '../lib/report/exportPdf';
import {
  KIND_EMOJI,
  addDays,
  formatDateCN,
  formatDateShort,
  formatDurationCN,
  formatNumber,
  formatVolume,
  toISODate,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import { SESSION_KIND_LABEL, type SessionKind, type WorkoutSummary } from '../types';

type Filter = SessionKind | 'all';

function monthLabel(date: string): string {
  return `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月`;
}

export default function HistoryPage() {
  const toast = useToast();
  const {
    ready,
    summaries,
    plans,
    bodyMetrics,
    dailyLogs,
    deleteSummary,
    saveSummary,
    duplicateSummary,
    renameSummary,
  } = useAppData();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<WorkoutSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkoutSummary | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    durationMin: '',
    volume: '',
    sets: '',
    reps: '',
    rpe: '',
    fatigue: '',
    feeling: '',
    note: '',
  });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDate, setCopyDate] = useState(toISODate());
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...summaries]
      .filter((s) => (filter === 'all' ? true : s.kind === filter))
      .filter((s) =>
        q
          ? s.planTitle.toLowerCase().includes(q) ||
            s.completedExercises.some((e) => e.toLowerCase().includes(q))
          : true,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [summaries, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutSummary[]>();
    filtered.forEach((s) => {
      const key = s.date.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), s]);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const totals = useMemo(
    () => ({
      count: summaries.length,
      volume: summaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0),
      duration: summaries.reduce((n, s) => n + s.totalDurationSec, 0),
      avgRate: summaries.length
        ? summaries.reduce((n, s) => n + s.completionRate, 0) / summaries.length
        : 0,
    }),
    [summaries],
  );

  async function exportPdf(summary: WorkoutSummary) {
    setExporting(summary.id);
    try {
      await exportSummaryPdf({
        summary,
        plan: plans.find((p) => p.id === summary.planId) ?? null,
        metrics: bodyMetrics,
        dailyLog: dailyLogs.find((d) => d.date === summary.date) ?? null,
      });
      toast('PDF 已生成', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'PDF 导出失败', 'error');
    } finally {
      setExporting(null);
    }
  }

  if (!ready) {
    return (
      <Page title="历史训练" back>
        <div className="skeleton" style={{ height: 200 }} />
      </Page>
    );
  }

  return (
    <Page title="历史训练" sub={`共 ${totals.count} 次训练`} back>
      <div className="stat-grid" style={{ marginTop: 8 }}>
        <Stat label="累计训练" value={totals.count} unit="次" />
        <Stat label="累计容量" value={totals.volume > 0 ? formatVolume(totals.volume) : '—'} />
      </div>
      <div className="stat-grid" style={{ marginTop: 10 }}>
        <Stat label="累计时长" value={formatDurationCN(totals.duration)} />
        <Stat label="平均完成率" value={`${Math.round(totals.avgRate * 100)}%`} />
      </div>

      <SectionTitle>筛选与搜索</SectionTitle>
      <TextInput value={query} onChange={setQuery} placeholder="搜索计划名或动作名" />
      <div style={{ marginTop: 10 }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'strength', label: SESSION_KIND_LABEL.strength },
            { value: 'run', label: SESSION_KIND_LABEL.run },
            { value: 'football', label: SESSION_KIND_LABEL.football },
            { value: 'ride', label: SESSION_KIND_LABEL.ride },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card style={{ marginTop: 14 }}>
          <EmptyState emoji="📭" title="没有找到训练记录" desc="换个筛选条件，或先完成一次训练" />
        </Card>
      ) : (
        grouped.map(([month, items]) => (
          <div key={month}>
            <SectionTitle>
              {monthLabel(`${month}-01`)} · {items.length} 次
            </SectionTitle>
            <div className="list">
              {items.map((s) => (
                <ListRow
                  key={s.id}
                  title={`${KIND_EMOJI[s.kind]} ${s.planTitle}`}
                  sub={`${formatDateShort(s.date)} · 完成 ${Math.round(s.completionRate * 100)}% · ${s.totalSets} 组 · ${formatDurationCN(s.totalDurationSec)}`}
                  value={s.totalVolumeKg > 0 ? formatVolume(s.totalVolumeKg) : undefined}
                  onClick={() => setDetail(s)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      <Sheet
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? detail.planTitle : ''}
        footer={
          detail && (
            <div className="col" style={{ gap: 10 }}>
              <Button
                block
                variant="primary"
                size="lg"
                disabled={exporting === detail.id}
                onClick={() => void exportPdf(detail)}
              >
                <IconShare width={18} height={18} style={{ marginRight: 6 }} />
                {exporting === detail.id ? '正在生成 PDF…' : '导出中文 PDF'}
              </Button>
              <Button
                block
                size="lg"
                data-testid="record-edit-open"
                onClick={() => {
                  setEditForm({
                    title: detail.planTitle,
                    durationMin: String(Math.round(detail.totalDurationSec / 60)),
                    volume: String(Math.round(detail.totalVolumeKg)),
                    sets: String(detail.totalSets),
                    reps: String(detail.totalReps),
                    rpe: detail.rpe != null ? String(detail.rpe) : '',
                    fatigue: detail.fatigue != null ? String(detail.fatigue) : '',
                    feeling: detail.feeling ?? '',
                    note: detail.note ?? '',
                  });
                  setEditOpen(true);
                }}
              >
                编辑这条记录
              </Button>
              <div className="row" style={{ gap: 10 }}>
                <Button
                  block
                  size="lg"
                  data-testid="record-rename-open"
                  onClick={() => {
                    setRenameValue(detail.planTitle);
                    setRenameOpen(true);
                  }}
                >
                  重命名
                </Button>
                <Button
                  block
                  size="lg"
                  data-testid="record-copy-open"
                  onClick={() => {
                    setCopyDate(addDays(detail.date, 1));
                    setCopyOpen(true);
                  }}
                >
                  复制到其他日期
                </Button>
              </div>
              <Button block size="lg" variant="danger" onClick={() => setConfirmDelete(detail)}>
                <IconTrash width={18} height={18} style={{ marginRight: 6 }} />
                删除这条记录
              </Button>
            </div>
          )
        }
      >
        {detail && (
          <div>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="muted small">{formatDateShort(detail.date)}</span>
              <Chip tone="green">完成 {Math.round(detail.completionRate * 100)}%</Chip>
            </div>
            <div className="stat-grid three">
              <Stat label="时长" value={formatDurationCN(detail.totalDurationSec)} />
              <Stat label="组数" value={detail.totalSets} />
              <Stat label="容量" value={formatVolume(detail.totalVolumeKg)} />
            </div>
            <div className="stat-grid three" style={{ marginTop: 10 }}>
              <Stat label="次数" value={detail.totalReps} />
              <Stat label="RPE" value={detail.rpe ?? '—'} />
              <Stat
                label="体重"
                value={detail.bodyWeightKg != null ? `${formatNumber(detail.bodyWeightKg)}kg` : '—'}
              />
            </div>

            {detail.completedExercises.length > 0 && (
              <>
                <div className="small muted" style={{ margin: '14px 0 6px' }}>
                  完成动作
                </div>
                <div className="wrap" style={{ gap: 6 }}>
                  {detail.completedExercises.map((n) => (
                    <Chip key={n} tone="green">
                      {n}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            {detail.skippedExercises.length > 0 && (
              <>
                <div className="small muted" style={{ margin: '14px 0 6px' }}>
                  跳过动作
                </div>
                <div className="wrap" style={{ gap: 6 }}>
                  {detail.skippedExercises.map((n) => (
                    <Chip key={n} tone="orange">
                      {n}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            {detail.cardio.length > 0 && (
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th className="num">时间</th>
                      <th className="num">距离</th>
                      <th className="num">配速</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.cardio.map((c) => (
                      <tr key={`${c.exerciseName}-${c.durationSec}`}>
                        <td>{c.exerciseName}</td>
                        <td className="num">{c.durationSec ? formatDurationCN(c.durationSec) : '—'}</td>
                        <td className="num">{c.distanceKm ? `${formatNumber(c.distanceKm, 2)} km` : '—'}</td>
                        <td className="num">{c.paceText ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(detail.feeling || detail.note) && (
              <div className="small" style={{ marginTop: 12 }}>
                {detail.feeling && <div>感受：{detail.feeling}</div>}
                {detail.note && <div style={{ marginTop: 4 }}>备注：{detail.note}</div>}
              </div>
            )}
            {detail.painSites && detail.painSites.length > 0 && (
              <div className="small" style={{ marginTop: 10, color: 'var(--orange)' }}>
                疼痛部位：{detail.painSites.join('、')}
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* 编辑训练记录 */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑训练记录"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            data-testid="record-edit-save"
            onClick={async () => {
              if (!detail) return;
              const next: WorkoutSummary = {
                ...detail,
                planTitle: editForm.title.trim() || detail.planTitle,
                totalDurationSec: Math.max(
                  0,
                  Math.round((Number(editForm.durationMin) || 0) * 60),
                ),
                totalVolumeKg: Number(editForm.volume) || 0,
                totalSets: Number(editForm.sets) || 0,
                totalReps: Number(editForm.reps) || 0,
                rpe: editForm.rpe ? Number(editForm.rpe) : null,
                fatigue: editForm.fatigue ? Number(editForm.fatigue) : null,
                feeling: editForm.feeling.trim() || undefined,
                note: editForm.note.trim() || undefined,
              };
              await saveSummary(next);
              setDetail(next);
              setEditOpen(false);
              toast('记录已更新', 'success');
            }}
          >
            保存修改
          </Button>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <Field label="训练名称">
            <TextInput
              value={editForm.title}
              onChange={(v) => setEditForm((f) => ({ ...f, title: v }))}
              testId="record-edit-title"
            />
          </Field>
          <div className="form-row">
            <div className="grow">
              <Field label="时长（分钟）">
                <TextInput
                  value={editForm.durationMin}
                  onChange={(v) => setEditForm((f) => ({ ...f, durationMin: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="总容量（kg）">
                <TextInput
                  value={editForm.volume}
                  onChange={(v) => setEditForm((f) => ({ ...f, volume: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </div>
          <div className="form-row">
            <div className="grow">
              <Field label="总组数">
                <TextInput
                  value={editForm.sets}
                  onChange={(v) => setEditForm((f) => ({ ...f, sets: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="总次数">
                <TextInput
                  value={editForm.reps}
                  onChange={(v) => setEditForm((f) => ({ ...f, reps: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="RPE">
                <TextInput
                  value={editForm.rpe}
                  onChange={(v) => setEditForm((f) => ({ ...f, rpe: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="疲劳 1-5">
                <TextInput
                  value={editForm.fatigue}
                  onChange={(v) => setEditForm((f) => ({ ...f, fatigue: v }))}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </div>
          <Field label="训练感受">
            <TextArea
              value={editForm.feeling}
              onChange={(v) => setEditForm((f) => ({ ...f, feeling: v }))}
              rows={2}
            />
          </Field>
          <Field label="备注">
            <TextArea
              value={editForm.note}
              onChange={(v) => setEditForm((f) => ({ ...f, note: v }))}
              rows={2}
            />
          </Field>
        </div>
      </Sheet>

      {/* 重命名记录 */}
      <Sheet
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="重命名这条记录"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            data-testid="record-rename-save"
            onClick={async () => {
              if (!detail) return;
              await renameSummary(detail.id, renameValue);
              setDetail({ ...detail, planTitle: renameValue.trim() || detail.planTitle });
              setRenameOpen(false);
              toast('已重命名', 'success');
            }}
          >
            保存名称
          </Button>
        }
      >
        <Field label="记录名称">
          <TextInput
            value={renameValue}
            onChange={setRenameValue}
            testId="record-rename-input"
          />
        </Field>
      </Sheet>

      {/* 复制记录到其他日期 */}
      <Sheet
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="复制到其他日期"
        footer={
          <Button
            block
            variant="primary"
            size="lg"
            data-testid="record-copy-save"
            onClick={async () => {
              if (!detail) return;
              const created = await duplicateSummary(detail.id, copyDate);
              setCopyOpen(false);
              setDetail(null);
              toast(created ? `已复制到 ${copyDate}` : '复制失败', created ? 'success' : 'error');
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
            data-testid="record-copy-date"
            onChange={(e) => setCopyDate(e.target.value)}
          />
        </Field>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          会生成一条新的训练记录，原始记录保持不变。
        </div>
      </Sheet>

      <Confirm
        open={confirmDelete != null}
        title="删除这条训练记录？"
        message={
          confirmDelete
            ? `将删除「${confirmDelete.planTitle}」（${formatDateCN(confirmDelete.date)}）的训练记录，删除后无法恢复，统计数据会同步更新。`
            : ''
        }
        confirmText="删除"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const id = confirmDelete?.id;
          setConfirmDelete(null);
          setDetail(null);
          if (id) void deleteSummary(id).then(() => toast('记录已删除'));
        }}
      />
    </Page>
  );
}
