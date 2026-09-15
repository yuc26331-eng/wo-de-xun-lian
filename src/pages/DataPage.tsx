/**
 * 数据
 * 体重 / 体脂 / 训练量 / RPE / 睡眠恢复 / 饮水蛋白 / 训练日历 / 个人纪录 PR
 */
import { useEffect, useMemo, useState } from 'react';
import { Page } from '../components/Page';
import { BarChart, CalendarGrid, LineChart, type ChartPoint } from '../components/SimpleChart';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  Field,
  NumberInput,
  SectionTitle,
  Segmented,
  Sheet,
  Stat,
  Stepper,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { IconPlus, IconTrash } from '../components/icons';
import {
  KIND_EMOJI,
  addDays,
  dayDiff,
  formatDateCN,
  formatDateShort,
  formatNumber,
  formatVolume,
  nowISO,
  toISODate,
  uid,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import type { BodyMetric, ISODate, PRMetric, PersonalRecord } from '../types';

type Tab = 'trends' | 'calendar' | 'records';

const PR_METRICS: { value: PRMetric; label: string; unit: string }[] = [
  { value: 'weight', label: '最大重量', unit: 'kg' },
  { value: 'reps', label: '次数', unit: '次' },
  { value: 'volume', label: '训练容量', unit: 'kg' },
  { value: 'time', label: '时间', unit: '秒' },
  { value: 'distance', label: '距离', unit: 'km' },
  { value: 'pace', label: '配速', unit: '秒/km' },
];

const METRIC_LABEL: Record<PRMetric, string> = {
  weight: '最大重量',
  reps: '最多次数',
  volume: '最大容量',
  time: '最长时间',
  distance: '最远距离',
  pace: '最快配速',
};

function buildSeries<T>(
  rows: T[],
  pick: (row: T) => { date: ISODate; value: number | null | undefined } | null,
  from: ISODate,
  limit = 60,
): ChartPoint[] {
  return rows
    .map(pick)
    .filter((r): r is { date: ISODate; value: number } => r != null && r.value != null)
    .filter((r) => r.date >= from)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-limit)
    .map((r) => ({ label: formatDateShort(r.date), value: r.value }));
}

export default function DataPage() {
  const toast = useToast();
  const {
    ready,
    bodyMetrics,
    summaries,
    dailyLogs,
    goals,
    prs,
    settings,
    saveBodyMetric,
    saveDailyLog,
    savePR,
    deletePR,
    saveGoal,
  } = useAppData();

  const today = toISODate();
  const [tab, setTab] = useState<Tab>('trends');
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<ISODate | null>(today);
  const [entryOpen, setEntryOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [confirmPR, setConfirmPR] = useState<PersonalRecord | null>(null);

  // 身体数据表单
  const [form, setForm] = useState<{
    date: ISODate;
    weight: number | null;
    bodyFat: number | null;
    sleep: number | null;
    sleepQuality: number;
    soreness: number;
    recovery: number;
    restingHr: number | null;
    water: number | null;
    protein: number | null;
    note: string;
  }>({
    date: today,
    weight: null,
    bodyFat: null,
    sleep: null,
    sleepQuality: 3,
    soreness: 2,
    recovery: 3,
    restingHr: null,
    water: null,
    protein: null,
    note: '',
  });

  // PR 表单
  const [prForm, setPrForm] = useState<{
    id: string | null;
    exerciseName: string;
    metric: PRMetric;
    value: number | null;
    unit: string;
    date: ISODate;
    note: string;
  }>({
    id: null,
    exerciseName: '',
    metric: 'weight',
    value: null,
    unit: 'kg',
    date: today,
    note: '',
  });

  const days = Number(range);
  const from = addDays(today, -(days - 1));

  const weightSeries = useMemo(
    () => buildSeries(bodyMetrics, (m) => ({ date: m.date, value: m.weightKg }), from),
    [bodyMetrics, from],
  );
  const bodyFatSeries = useMemo(
    () => buildSeries(bodyMetrics, (m) => ({ date: m.date, value: m.bodyFatPct }), from),
    [bodyMetrics, from],
  );
  const sleepSeries = useMemo(
    () => buildSeries(bodyMetrics, (m) => ({ date: m.date, value: m.sleepHours }), from),
    [bodyMetrics, from],
  );
  const recoverySeries = useMemo(
    () => buildSeries(bodyMetrics, (m) => ({ date: m.date, value: m.recovery }), from, 90),
    [bodyMetrics, from],
  );
  const rpeSeries = useMemo(
    () => buildSeries(summaries, (s) => ({ date: s.date, value: s.rpe }), from),
    [summaries, from],
  );
  const volumeSeries = useMemo(() => {
    const byDate = new Map<ISODate, number>();
    summaries
      .filter((s) => s.date >= from && s.totalVolumeKg > 0)
      .forEach((s) => byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.totalVolumeKg));
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-30)
      .map(([date, value]) => ({ label: formatDateShort(date), value: Math.round(value) }));
  }, [summaries, from]);
  const proteinSeries = useMemo(
    () =>
      buildSeries(
        dailyLogs,
        (d) => ({ date: d.date, value: d.supplements?.proteinG ?? null }),
        from,
      ),
    [dailyLogs, from],
  );
  const waterSeries = useMemo(
    () => buildSeries(bodyMetrics, (m) => ({ date: m.date, value: m.waterMl }), from),
    [bodyMetrics, from],
  );

  const rangeSummaries = useMemo(
    () => summaries.filter((s) => s.date >= from && s.date <= today),
    [summaries, from, today],
  );
  const totalVolume = rangeSummaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0);
  const avgRpe = (() => {
    const list = rangeSummaries.map((s) => s.rpe).filter((v): v is number => v != null);
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  })();
  const streak = useMemo(() => {
    const trained = new Set(summaries.map((s) => s.date));
    let cursor = trained.has(today) ? today : addDays(today, -1);
    if (!trained.has(cursor)) return 0;
    let n = 0;
    while (trained.has(cursor)) {
      n += 1;
      cursor = addDays(cursor, -1);
    }
    return n;
  }, [summaries, today]);

  const trainedDates = useMemo(() => new Set(summaries.map((s) => s.date)), [summaries]);
  const selectedSummary = summaries.find((s) => s.date === selectedDate) ?? null;
  const selectedMetric = bodyMetrics.find((m) => m.date === selectedDate) ?? null;
  const selectedLog = dailyLogs.find((d) => d.date === selectedDate) ?? null;

  const latestWeight = weightSeries.length ? weightSeries[weightSeries.length - 1] : null;
  const firstWeight = weightSeries.length > 1 ? weightSeries[0] : null;
  const weightDelta =
    latestWeight && firstWeight ? Math.round((latestWeight.value - firstWeight.value) * 10) / 10 : null;

  useEffect(() => {
    if (!entryOpen) return;
    const date = selectedDate ?? today;
    const metric = bodyMetrics.find((m) => m.date === date);
    const log = dailyLogs.find((d) => d.date === date);
    setForm({
      date,
      weight: metric?.weightKg ?? null,
      bodyFat: metric?.bodyFatPct ?? null,
      sleep: metric?.sleepHours ?? log?.sleepHours ?? null,
      sleepQuality: metric?.sleepQuality ?? 3,
      soreness: metric?.soreness ?? 2,
      recovery: metric?.recovery ?? 3,
      restingHr: metric?.restingHr ?? null,
      water: metric?.waterMl ?? null,
      protein: log?.supplements?.proteinG ?? metric?.proteinG ?? null,
      note: metric?.note ?? '',
    });
  }, [entryOpen, selectedDate, today, bodyMetrics, dailyLogs]);

  async function saveEntry() {
    const patch: Partial<BodyMetric> & { date: ISODate } = {
      date: form.date,
      weightKg: form.weight,
      bodyFatPct: form.bodyFat,
      sleepHours: form.sleep,
      sleepQuality: form.sleepQuality,
      soreness: form.soreness,
      recovery: form.recovery,
      restingHr: form.restingHr,
      waterMl: form.water,
      proteinG: form.protein,
      note: form.note.trim(),
    };
    await saveBodyMetric(patch);
    if (form.protein != null) {
      await saveDailyLog({
        date: form.date,
        weightKg: form.weight,
        sleepHours: form.sleep,
        supplements: { proteinG: form.protein },
      });
    }
    setEntryOpen(false);
    toast('身体数据已保存', 'success');
  }

  async function savePRForm() {
    const name = prForm.exerciseName.trim();
    if (!name || prForm.value == null) {
      toast('请填写动作名称和数值', 'error');
      return;
    }
    const record: PersonalRecord = {
      id: prForm.id ?? uid('pr'),
      exerciseName: name,
      metric: prForm.metric,
      value: prForm.value,
      unit: prForm.unit,
      date: prForm.date,
      note: prForm.note.trim() || undefined,
      createdAt: nowISO(),
    };
    await savePR(record);
    setPrOpen(false);
    toast('个人纪录已保存', 'success');
  }

  if (!ready) {
    return (
      <Page title="数据">
        <div className="skeleton" style={{ height: 200 }} />
      </Page>
    );
  }

  return (
    <Page title="数据" sub={`最近 ${days} 天 · 连续打卡 ${streak} 天`}>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trends', label: '趋势' },
          { value: 'calendar', label: '日历' },
          { value: 'records', label: '纪录' },
        ]}
      />

      {tab === 'trends' && (
        <div style={{ marginTop: 14 }}>
          <Segmented<'7' | '30' | '90'>
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '30', label: '近 30 天' },
              { value: '90', label: '近 90 天' },
            ]}
          />

          <div className="stat-grid three" style={{ marginTop: 14 }}>
            <Stat label="训练次数" value={rangeSummaries.length} />
            <Stat label="总容量" value={totalVolume > 0 ? formatVolume(totalVolume) : '—'} />
            <Stat label="平均 RPE" value={avgRpe != null ? formatNumber(avgRpe) : '—'} />
          </div>

          <SectionTitle
            action="记录数据"
            onAction={() => {
              setSelectedDate(today);
              setEntryOpen(true);
            }}
          >
            体重趋势
          </SectionTitle>
          <Card>
            <LineChart
              points={weightSeries}
              unit="kg"
              summary={
                <>
                  <strong>{latestWeight ? `${formatNumber(latestWeight.value)} kg` : '—'}</strong>
                  {weightDelta != null && (
                    <span style={{ color: weightDelta > 0 ? 'var(--orange)' : 'var(--green)' }}>
                      {weightDelta > 0 ? '↑' : '↓'} {formatNumber(Math.abs(weightDelta))} kg
                    </span>
                  )}
                  {settings.bodyWeightGoalKg != null && <span>目标 {settings.bodyWeightGoalKg} kg</span>}
                </>
              }
            />
          </Card>

          {bodyFatSeries.length > 0 && (
            <>
              <SectionTitle>体脂率</SectionTitle>
              <Card>
                <LineChart points={bodyFatSeries} unit="%" tone="var(--purple)" />
              </Card>
            </>
          )}

          <SectionTitle>训练量（kg）</SectionTitle>
          <Card>
            <BarChart points={volumeSeries} unit="kg" />
            <div className="chart-summary">
              <strong>{formatVolume(totalVolume)}</strong>
              <span>合计训练容量</span>
            </div>
          </Card>

          <SectionTitle>训练 RPE</SectionTitle>
          <Card>
            <LineChart points={rpeSeries} tone="var(--orange)" />
          </Card>

          <SectionTitle>睡眠与恢复</SectionTitle>
          <Card>
            <div className="small muted" style={{ marginBottom: 6 }}>
              睡眠时长（小时）
            </div>
            <LineChart points={sleepSeries} unit="h" tone="var(--purple)" height={120} />
            <div className="small muted" style={{ margin: '14px 0 6px' }}>
              恢复状态（1-5）
            </div>
            <LineChart points={recoverySeries} tone="var(--green)" height={120} />
          </Card>

          <SectionTitle>饮水与蛋白质</SectionTitle>
          <Card>
            <div className="small muted" style={{ marginBottom: 6 }}>
              蛋白质（g）
            </div>
            <BarChart points={proteinSeries} unit="g" tone="var(--green)" height={120} />
            <div className="small muted" style={{ margin: '14px 0 6px' }}>
              饮水（ml）
            </div>
            <BarChart points={waterSeries} unit="ml" height={120} />
          </Card>

          <Button
            block
            variant="primary"
            size="lg"
            style={{ marginTop: 14 }}
            onClick={() => {
              setSelectedDate(today);
              setEntryOpen(true);
            }}
            data-testid="open-metric-entry"
          >
            记录今天的身体数据
          </Button>
        </div>
      )}

      {tab === 'calendar' && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <button
                className="icon-btn"
                aria-label="上个月"
                onClick={() => {
                  const [y, m] = month.split('-').map(Number);
                  const d = new Date(y, m - 2, 1);
                  setMonth(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
                }}
              >
                ‹
              </button>
              <span className="strong">
                {Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月
              </span>
              <button
                className="icon-btn"
                aria-label="下个月"
                onClick={() => {
                  const [y, m] = month.split('-').map(Number);
                  const d = new Date(y, m, 1);
                  setMonth(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
                }}
              >
                ›
              </button>
            </div>
            <CalendarGrid
              month={month}
              trainedDates={trainedDates}
              selected={selectedDate}
              onSelect={setSelectedDate}
            />
            <div className="tiny muted" style={{ marginTop: 10 }}>
              本月训练 {Array.from(trainedDates).filter((d) => d.startsWith(month)).length} 天 ·
              点选日期可查看当天记录
            </div>
          </Card>

          {selectedDate && (
            <Card>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="strong">{formatDateCN(selectedDate)}</span>
                <Chip tone={selectedSummary ? 'green' : 'default'}>
                  {selectedSummary ? '已训练' : '未训练'}
                </Chip>
              </div>
              {selectedSummary ? (
                <>
                  <div className="metric-row">
                    <span className="label">
                      {KIND_EMOJI[selectedSummary.kind]} {selectedSummary.planTitle}
                    </span>
                    <span className="value">{Math.round(selectedSummary.completionRate * 100)}%</span>
                  </div>
                  <div className="metric-row">
                    <span className="label">训练量</span>
                    <span className="value">{formatVolume(selectedSummary.totalVolumeKg)}</span>
                  </div>
                  <div className="metric-row">
                    <span className="label">组数 / RPE</span>
                    <span className="value">
                      {selectedSummary.totalSets} 组 · {selectedSummary.rpe ?? '—'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="tiny muted" style={{ marginBottom: 8 }}>
                  这一天没有训练记录，可以补记身体数据。
                </div>
              )}
              <div className="metric-row">
                <span className="label">体重</span>
                <span className="value">
                  {selectedMetric?.weightKg != null ? `${formatNumber(selectedMetric.weightKg)} kg` : '—'}
                </span>
              </div>
              <div className="metric-row">
                <span className="label">睡眠 / 恢复</span>
                <span className="value">
                  {selectedMetric?.sleepHours != null ? `${formatNumber(selectedMetric.sleepHours)}h` : '—'} ·{' '}
                  {selectedMetric?.recovery ?? '—'}/5
                </span>
              </div>
              <div className="metric-row">
                <span className="label">饮水 / 蛋白</span>
                <span className="value">
                  {selectedMetric?.waterMl ?? '—'} ml · {selectedLog?.supplements?.proteinG ?? '—'} g
                </span>
              </div>
              <Button block size="lg" style={{ marginTop: 12 }} onClick={() => setEntryOpen(true)}>
                记录这天的数据
              </Button>
            </Card>
          )}
        </div>
      )}

      {tab === 'records' && (
        <div style={{ marginTop: 14 }}>
          <SectionTitle action="+ 添加 PR" onAction={() => setPrOpen(true)}>
            个人纪录 PR
          </SectionTitle>
          {prs.length === 0 ? (
            <Card>
              <EmptyState
                emoji="🏆"
                title="还没有个人纪录"
                desc="例如：深蹲 120kg、5 公里 22:30，记录后可以长期追踪"
                action={
                  <Button variant="primary" onClick={() => setPrOpen(true)}>
                    添加第一条 PR
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card>
              {[...prs]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((pr) => (
                  <div className="pr-row" key={pr.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong truncate">
                        {pr.exerciseName} · {METRIC_LABEL[pr.metric]}
                      </div>
                      <div className="tiny muted">
                        {formatDateShort(pr.date)}
                        {pr.note ? ` · ${pr.note}` : ''}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="strong nowrap">
                        {formatNumber(pr.value, pr.metric === 'pace' ? 0 : 1)}
                        {pr.unit}
                      </span>
                      <button
                        className="icon-btn"
                        aria-label="删除纪录"
                        onClick={() => setConfirmPR(pr)}
                      >
                        <IconTrash width={18} height={18} />
                      </button>
                    </div>
                  </div>
                ))}
            </Card>
          )}

          <SectionTitle>目标进度</SectionTitle>
          {goals.length === 0 ? (
            <Card>
              <EmptyState emoji="🎯" title="还没有目标" desc="在「我的」页面添加体重、力量或训练频率目标" />
            </Card>
          ) : (
            <Card>
              {goals.map((g) => (
                <div key={g.id} style={{ padding: '10px 0' }}>
                  <div className="row-between">
                    <span className={g.done ? 'muted' : 'strong'}>
                      {g.done ? '✅ ' : ''}
                      {g.title}
                    </span>
                    <span className="tiny muted">
                      {g.targetValue != null ? `目标 ${formatNumber(g.targetValue)}${g.unit ?? ''}` : ''}
                    </span>
                  </div>
                  {g.targetValue != null &&
                    (() => {
                      const current = bodyMetrics.find((m) => m.weightKg != null)?.weightKg ?? null;
                      const pct =
                        current != null && g.targetValue
                          ? Math.max(
                              4,
                              Math.min(100, 100 - (Math.abs(current - g.targetValue) / Math.max(g.targetValue, 1)) * 100),
                            )
                          : 4;
                      return (
                        <div className="goal-progress" style={{ marginTop: 8 }}>
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      );
                    })()}
                  {!g.done && (
                    <button
                      className="link"
                      style={{ marginTop: 8 }}
                      onClick={() => void saveGoal({ ...g, done: true })}
                    >
                      标记为已完成
                    </button>
                  )}
                </div>
              ))}
            </Card>
          )}

          <SectionTitle>训练统计</SectionTitle>
          <Card>
            <div className="metric-row">
              <span className="label">连续打卡</span>
              <span className="value">{streak} 天</span>
            </div>
            <div className="metric-row">
              <span className="label">累计训练次数</span>
              <span className="value">{summaries.length} 次</span>
            </div>
            <div className="metric-row">
              <span className="label">累计训练容量</span>
              <span className="value">
                {formatVolume(summaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0))}
              </span>
            </div>
            <div className="metric-row">
              <span className="label">最近 7 天训练</span>
              <span className="value">
                {summaries.filter((s) => dayDiff(today, s.date) < 7 && dayDiff(today, s.date) >= 0).length} 次
              </span>
            </div>
          </Card>
        </div>
      )}

      {/* 身体数据录入 */}
      <Sheet
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title={`记录身体数据 · ${formatDateShort(form.date)}`}
        footer={
          <Button block variant="primary" size="lg" onClick={() => void saveEntry()} data-testid="save-metric">
            保存
          </Button>
        }
      >
        <div className="row" style={{ gap: 10 }}>
          <div className="grow">
            <Field label="体重（kg）">
              <NumberInput
                value={form.weight}
                onChange={(v) => setForm((f) => ({ ...f, weight: v }))}
                testId="metric-weight"
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="体脂率（%）">
              <NumberInput value={form.bodyFat} onChange={(v) => setForm((f) => ({ ...f, bodyFat: v }))} />
            </Field>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <div className="grow">
            <Field label="睡眠（小时）">
              <NumberInput value={form.sleep} onChange={(v) => setForm((f) => ({ ...f, sleep: v }))} />
            </Field>
          </div>
          <div className="grow">
            <Field label="静息心率">
              <NumberInput
                value={form.restingHr}
                onChange={(v) => setForm((f) => ({ ...f, restingHr: v }))}
                dec={0}
              />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label={`睡眠质量：${form.sleepQuality}/5`}>
            <Stepper
              value={form.sleepQuality}
              onChange={(v) => setForm((f) => ({ ...f, sleepQuality: v }))}
              min={1}
              max={5}
            />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label={`酸痛程度：${form.soreness}/5`}>
            <Stepper
              value={form.soreness}
              onChange={(v) => setForm((f) => ({ ...f, soreness: v }))}
              min={1}
              max={5}
            />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label={`恢复状态：${form.recovery}/5`}>
            <Stepper
              value={form.recovery}
              onChange={(v) => setForm((f) => ({ ...f, recovery: v }))}
              min={1}
              max={5}
            />
          </Field>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <div className="grow">
            <Field label="饮水（ml）">
              <NumberInput value={form.water} onChange={(v) => setForm((f) => ({ ...f, water: v }))} dec={0} />
            </Field>
          </div>
          <div className="grow">
            <Field label="蛋白质（g）">
              <NumberInput value={form.protein} onChange={(v) => setForm((f) => ({ ...f, protein: v }))} dec={0} />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="备注（酸痛、伤病等）">
            <TextArea value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} rows={2} />
          </Field>
        </div>
      </Sheet>

      {/* PR 录入 */}
      <Sheet
        open={prOpen}
        onClose={() => setPrOpen(false)}
        title={prForm.id ? '编辑个人纪录' : '添加个人纪录'}
        footer={
          <Button block variant="primary" size="lg" onClick={() => void savePRForm()}>
            保存纪录
          </Button>
        }
      >
        <Field label="动作或项目">
          <TextInput
            value={prForm.exerciseName}
            onChange={(v) => setPrForm((f) => ({ ...f, exerciseName: v }))}
            placeholder="例如：杠铃深蹲 / 5 公里跑"
            testId="pr-name"
          />
        </Field>
        <div style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            纪录类型
          </div>
          <div className="wrap" style={{ gap: 6 }}>
            {PR_METRICS.map((m) => (
              <button
                key={m.value}
                className={`chip tap ${prForm.metric === m.value ? 'accent' : ''}`}
                onClick={() => setPrForm((f) => ({ ...f, metric: m.value, unit: m.unit }))}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <div className="grow">
            <Field label={`数值（${prForm.unit}）`}>
              <NumberInput
                value={prForm.value}
                onChange={(v) => setPrForm((f) => ({ ...f, value: v }))}
                dec={1}
                testId="pr-value"
              />
            </Field>
          </div>
          <div className="grow">
            <Field label="日期">
              <TextInput
                type="date"
                value={prForm.date}
                onChange={(v) => setPrForm((f) => ({ ...f, date: v as ISODate }))}
              />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="备注（可选）">
            <TextInput value={prForm.note} onChange={(v) => setPrForm((f) => ({ ...f, note: v }))} />
          </Field>
        </div>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          <IconPlus width={14} height={14} /> 记录后可以在「纪录」页长期追踪，训练总结里的重量也可以手动补录。
        </div>
      </Sheet>

      <Confirm
        open={confirmPR != null}
        title="删除这条个人纪录？"
        confirmText="删除"
        danger
        onCancel={() => setConfirmPR(null)}
        onConfirm={() => {
          const id = confirmPR?.id;
          setConfirmPR(null);
          if (id) void deletePR(id).then(() => toast('已删除'));
        }}
      />
    </Page>
  );
}
