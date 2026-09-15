/**
 * 总结
 * 今日总结 / 训练报告 / PDF 导入 / 导出中文 PDF
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { PdfDropZone, PdfImportButton } from '../components/PdfImportButton';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  Field,
  ListRow,
  NumberInput,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  Stepper,
  TextArea,
  useToast,
} from '../components/ui';
import { IconShare, IconTrash } from '../components/icons';
import { exportSummaryPdf } from '../lib/report/exportPdf';
import { PAIN_SITES } from '../lib/session';
import {
  KIND_EMOJI,
  formatDateCN,
  formatDateShort,
  formatDurationCN,
  formatNumber,
  formatVolume,
  toISODate,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import { PDF_KIND_LABEL, type WorkoutSummary } from '../types';

type Tab = 'today' | 'reports' | 'import';

function CardioTable({ summary }: { summary: WorkoutSummary }) {
  if (!summary.cardio.length) return null;
  return (
    <div className="table-scroll" style={{ marginTop: 10 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>项目</th>
            <th className="num">时间</th>
            <th className="num">距离</th>
            <th className="num">配速</th>
            <th className="num">心率</th>
          </tr>
        </thead>
        <tbody>
          {summary.cardio.map((c) => (
            <tr key={`${c.exerciseName}-${c.durationSec}`}>
              <td>{c.exerciseName}</td>
              <td className="num">{c.durationSec ? formatDurationCN(c.durationSec) : '—'}</td>
              <td className="num">{c.distanceKm ? `${formatNumber(c.distanceKm, 2)} km` : '—'}</td>
              <td className="num">{c.paceText ?? '—'}</td>
              <td className="num">{c.avgHr ? `${c.avgHr}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryDetail({ summary }: { summary: WorkoutSummary }) {
  return (
    <div>
      <div className="stat-grid three">
        <Stat label="完成率" value={`${Math.round(summary.completionRate * 100)}%`} />
        <Stat label="总时长" value={formatDurationCN(summary.totalDurationSec)} />
        <Stat label="总容量" value={formatVolume(summary.totalVolumeKg)} />
      </div>
      <div className="stat-grid three" style={{ marginTop: 10 }}>
        <Stat label="总组数" value={summary.totalSets} />
        <Stat label="总次数" value={summary.totalReps} />
        <Stat label="RPE" value={summary.rpe ?? '—'} />
      </div>

      {summary.completedExercises.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>
            完成动作（{summary.completedExercises.length}）
          </div>
          <div className="wrap" style={{ gap: 6 }}>
            {summary.completedExercises.map((n) => (
              <Chip key={n} tone="green">
                {n}
              </Chip>
            ))}
          </div>
        </>
      )}
      {summary.skippedExercises.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>
            跳过动作（{summary.skippedExercises.length}）
          </div>
          <div className="wrap" style={{ gap: 6 }}>
            {summary.skippedExercises.map((n) => (
              <Chip key={n} tone="orange">
                {n}
              </Chip>
            ))}
          </div>
        </>
      )}

      <CardioTable summary={summary} />

      {summary.painSites && summary.painSites.length > 0 && (
        <div className="small" style={{ marginTop: 12, color: 'var(--orange)' }}>
          疼痛部位：{summary.painSites.join('、')}
        </div>
      )}
      {(summary.feeling || summary.note) && (
        <div className="small" style={{ marginTop: 12 }}>
          {summary.feeling && <div>感受：{summary.feeling}</div>}
          {summary.note && <div style={{ marginTop: 4 }}>备注：{summary.note}</div>}
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 12 }}>
        {formatDateCN(summary.date)} · {formatDurationCN(summary.totalDurationSec)} ·{' '}
        {summary.bodyWeightKg ? `体重 ${formatNumber(summary.bodyWeightKg)}kg` : '未记录体重'}
      </div>
    </div>
  );
}

export default function SummaryPage() {
  const toast = useToast();
  const {
    ready,
    summaries,
    plans,
    bodyMetrics,
    dailyLogs,
    pdfImports,
    deletePdfImport,
    saveDailyLog,
    saveSummary,
    saveBodyMetric,
    deleteSummary,
  } = useAppData();

  const today = toISODate();
  const [searchParams] = useSearchParams();
  const requestedDate = searchParams.get('date');
  // 跟练结束后会跳到 /summary?date=YYYY-MM-DD，这里允许查看指定日期
  const activeDate =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const [tab, setTab] = useState<Tab>('today');
  const [detail, setDetail] = useState<WorkoutSummary | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkoutSummary | null>(null);

  const todaySummary = useMemo(
    () =>
      summaries
        .filter((s) => s.date === activeDate)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null,
    [summaries, activeDate],
  );
  const log = useMemo(() => dailyLogs.find((d) => d.date === activeDate) ?? null, [dailyLogs, activeDate]);
  const todayMetric = useMemo(
    () => bodyMetrics.find((m) => m.date === activeDate) ?? null,
    [bodyMetrics, activeDate],
  );

  const [weight, setWeight] = useState<number | null>(null);
  const [rpe, setRpe] = useState(6);
  const [fatigue, setFatigue] = useState(3);
  const [feeling, setFeeling] = useState('');
  const [note, setNote] = useState('');
  const [painSites, setPainSites] = useState<string[]>([]);
  const [trainingContent, setTrainingContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWeight(todaySummary?.bodyWeightKg ?? todayMetric?.weightKg ?? log?.weightKg ?? null);
    setRpe(todaySummary?.rpe ?? log?.rpe ?? 6);
    setFatigue(todaySummary?.fatigue ?? log?.fatigue ?? 3);
    setFeeling(todaySummary?.feeling ?? log?.feeling ?? '');
    setNote(todaySummary?.note ?? log?.note ?? '');
    setPainSites(todaySummary?.painSites ?? (log?.pain ? log.pain.split(/[、,，]/).filter(Boolean) : []));
    setTrainingContent(
      log?.trainingContent ??
        (todaySummary ? `${todaySummary.planTitle}（${todaySummary.completedExercises.join('、')}）` : ''),
    );
  }, [todaySummary, todayMetric, log]);

  const recent = useMemo(
    () => [...summaries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40),
    [summaries],
  );

  async function saveToday() {
    if (saving) return;
    setSaving(true);
    try {
      await saveDailyLog({
        date: activeDate,
        weightKg: weight,
        rpe,
        fatigue,
        feeling: feeling.trim(),
        note: note.trim(),
        pain: painSites.join('、'),
        trainingContent: trainingContent.trim(),
        trainingVolumeKg: todaySummary?.totalVolumeKg ?? null,
        summaryId: todaySummary?.id,
      });
      if (weight != null) await saveBodyMetric({ date: activeDate, weightKg: weight });
      if (todaySummary) {
        await saveSummary({
          ...todaySummary,
          rpe,
          fatigue,
          feeling: feeling.trim(),
          note: note.trim(),
          painSites: painSites.length ? painSites : undefined,
          bodyWeightKg: weight ?? todaySummary.bodyWeightKg,
        });
      }
      toast('今日总结已保存到历史', 'success');
    } finally {
      setSaving(false);
    }
  }

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
      <Page title="总结">
        <div className="skeleton" style={{ height: 200 }} />
      </Page>
    );
  }

  return (
    <Page title="总结" sub={formatDateCN(activeDate)}>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'today', label: '今日总结' },
          { value: 'reports', label: '训练报告' },
          { value: 'import', label: 'PDF 导入' },
        ]}
      />

      {tab === 'today' && (
        <div style={{ marginTop: 14 }}>
          {todaySummary ? (
            <Card>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div className="strong" style={{ fontSize: 17 }}>
                  {KIND_EMOJI[todaySummary.kind]} {todaySummary.planTitle}
                </div>
                <Chip tone="green">完成 {Math.round(todaySummary.completionRate * 100)}%</Chip>
              </div>
              <SummaryDetail summary={todaySummary} />
              <Button
                block
                size="lg"
                variant="primary"
                style={{ marginTop: 14 }}
                disabled={exporting === todaySummary.id}
                onClick={() => void exportPdf(todaySummary)}
              >
                <IconShare width={18} height={18} style={{ marginRight: 6 }} />
                {exporting === todaySummary.id ? '正在生成 PDF…' : '导出今日训练 PDF'}
              </Button>
              <div className="tiny muted center" style={{ marginTop: 8 }}>
                PDF 内嵌中文字体（约 2-3MB），中文不会乱码、内容不会被截断
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                emoji="📝"
                title="今天还没有训练记录"
                desc="完成一次训练后会自动生成总结，也可以先手动记录今天的感受"
              />
            </Card>
          )}

          <SectionTitle>今日感受与身体反馈</SectionTitle>
          <Card>
            <div className="row" style={{ gap: 10 }}>
              <div className="grow">
                <Field label="体重（kg）">
                  <NumberInput value={weight} onChange={setWeight} placeholder="例如 68.5" testId="summary-weight" />
                </Field>
              </div>
              <div className="grow">
                <Field label="训练 RPE">
                  <Stepper value={rpe} min={1} max={10} onChange={setRpe} />
                </Field>
              </div>
              <div className="grow">
                <Field label="疲劳程度">
                  <Stepper value={fatigue} min={1} max={5} onChange={setFatigue} />
                </Field>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                疼痛 / 不适部位（可多选）
              </div>
              <div className="wrap" style={{ gap: 6 }}>
                {PAIN_SITES.map((site) => {
                  const active = painSites.includes(site);
                  return (
                    <button
                      key={site}
                      className={`chip tap ${active ? 'red' : ''}`}
                      aria-pressed={active}
                      onClick={() =>
                        setPainSites((prev) =>
                          prev.includes(site) ? prev.filter((s) => s !== site) : [...prev, site],
                        )
                      }
                    >
                      {site}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <Field label="训练内容">
                <TextArea
                  value={trainingContent}
                  onChange={setTrainingContent}
                  rows={2}
                  placeholder="例如：下肢力量，深蹲 4×5 @90kg"
                />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="今日感受">
                <TextArea
                  value={feeling}
                  onChange={setFeeling}
                  rows={2}
                  placeholder="例如：状态不错，最后一组有点吃力"
                  testId="summary-feeling"
                />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="备注">
                <TextArea value={note} onChange={setNote} rows={2} placeholder="睡眠、饮食、补剂、伤病等" />
              </Field>
            </div>
            <Button
              block
              variant="primary"
              size="lg"
              style={{ marginTop: 14 }}
              disabled={saving}
              onClick={() => void saveToday()}
              data-testid="save-daily-summary"
            >
              {saving ? '保存中…' : '保存到历史'}
            </Button>
          </Card>
        </div>
      )}

      {tab === 'reports' && (
        <div style={{ marginTop: 14 }}>
          {recent.length === 0 ? (
            <Card>
              <EmptyState emoji="📊" title="还没有训练报告" desc="完成训练后可以在这里查看与导出 PDF" />
            </Card>
          ) : (
            <>
              <div className="list">
                {recent.map((s) => (
                  <ListRow
                    key={s.id}
                    title={`${KIND_EMOJI[s.kind]} ${s.planTitle}`}
                    sub={`${formatDateShort(s.date)} · 完成 ${Math.round(s.completionRate * 100)}% · ${s.totalSets} 组 · ${formatDurationCN(s.totalDurationSec)}`}
                    value={formatVolume(s.totalVolumeKg)}
                    onClick={() => setDetail(s)}
                  />
                ))}
              </div>
              <div className="tiny muted center">点开任意一条可以查看详情并导出中文 PDF</div>
            </>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="strong" style={{ fontSize: 16 }}>
              导入 ChatGPT PDF
            </div>
            <div className="tiny muted" style={{ marginTop: 4, marginBottom: 12 }}>
              支持健身计划、今日训练总结、周训练计划、身体数据报告。文字型 PDF 在本机解析；
              扫描版 PDF 会提示需要 OCR，不会假装识别成功。
            </div>
            <PdfImportButton variant="primary" block size="lg" label="选择 PDF 文件" testId="import-pdf-summary" />
            <div style={{ marginTop: 10 }}>
              <PdfDropZone label="拖拽 PDF 到此处导入" compact />
            </div>
          </Card>

          <SectionTitle>最近的导入</SectionTitle>
          {pdfImports.length === 0 ? (
            <Card>
              <EmptyState emoji="📄" title="还没有导入记录" />
            </Card>
          ) : (
            <div className="list">
              {[...pdfImports]
                .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
                .slice(0, 20)
                .map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.fileName}
                    sub={`${formatDateShort(r.importedAt.slice(0, 10))} · ${PDF_KIND_LABEL[r.kind]} · ${
                      r.ocrRequired ? '需要 OCR' : `${r.pageCount} 页`
                    } → ${r.saved ? '已保存' : '未保存'}`}
                    right={
                      <button
                        className="icon-btn"
                        aria-label="删除导入记录"
                        onClick={() => void deletePdfImport(r.id)}
                      >
                        <IconTrash width={18} height={18} />
                      </button>
                    }
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* 报告详情 */}
      <Sheet
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.planTitle}` : ''}
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
                {exporting === detail.id ? '正在生成 PDF…' : '导出中文 PDF'}
              </Button>
              <Button block size="lg" variant="danger" onClick={() => setConfirmDelete(detail)}>
                删除这条记录
              </Button>
            </div>
          )
        }
      >
        {detail && <SummaryDetail summary={detail} />}
      </Sheet>

      <Confirm
        open={confirmDelete != null}
        title="删除这条训练记录？"
        message="删除后无法恢复。"
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
