/**
 * 首页
 * 今日状态 / 今日计划 / 体重 / 恢复状态 / 大号「开始今天的训练」
 * 数据全部读写 IndexedDB，刷新、锁屏、关闭后不丢失。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/Page';
import { PdfDropZone, PdfImportButton } from '../components/PdfImportButton';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  ListRow,
  NumberInput,
  Ring,
  SectionTitle,
  Sheet,
  Stat,
  useToast,
} from '../components/ui';
import { IconFlame, IconPlay, IconTrophy } from '../components/icons';
import { exportPlanPdf } from '../lib/report/exportPdf';
import { buildLiveSession, elapsedSec, sessionProgress } from '../lib/session';
import {
  KIND_EMOJI,
  addDays,
  dayDiff,
  formatDateCN,
  formatDateShort,
  formatDurationCN,
  formatNumber,
  formatVolume,
  kindIsCardio,
  targetSummary,
  toISODate,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import { dailyProgress } from '../lib/summary/sections';
import { allTimeStats } from '../lib/progress';
import { CleanupBanner } from '../components/CleanupBanner';
import type { ISODate, TrainingPlan, WorkoutSummary } from '../types';

/** 今日计划：优先今天，其次最近的未来计划，最后回退到最近一次计划 */
function pickTodayPlan(plans: TrainingPlan[], today: ISODate): TrainingPlan | null {
  const active = plans.filter((p) => !p.archived);
  const todayPlans = active.filter((p) => p.date === today);
  if (todayPlans.length) return todayPlans[todayPlans.length - 1];

  const upcoming = active
    .filter((p) => p.date != null && dayDiff(p.date, today) < 0)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  if (upcoming.length) return upcoming[0];

  const past = active
    .filter((p) => p.date != null)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1));
  return past[0] ?? active[0] ?? null;
}

/** 连续打卡天数（有训练记录的连续天数，今天没练则从昨天开始算） */
function computeStreak(summaries: WorkoutSummary[], today: ISODate): number {
  const days = new Set(summaries.map((s) => s.date));
  let cursor = today;
  if (!days.has(cursor)) {
    cursor = addDays(today, -1);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function recoveryAdvice(sleep: number | null, soreness: number | null, recovery: number | null): string {
  if (recovery != null && recovery <= 2) return '恢复偏低：今天建议降低强度，优先保证动作质量与睡眠。';
  if (soreness != null && soreness >= 4) return '酸痛明显：热身延长 5-10 分钟，避免力竭组。';
  if (sleep != null && sleep < 6) return '睡眠不足：训练量下调 10-20%，组间休息适当延长。';
  if (recovery != null && recovery >= 4) return '恢复不错：可以按计划完成，注意最后一组保留 1-2 次余力。';
  return '按计划训练即可，训练中留意身体反馈。';
}

export default function HomePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const {
    ready,
    plans,
    summaries,
    bodyMetrics,
    dailyLogs,
    settings,
    liveSession,
    setLiveSession,
    saveBodyMetric,
  } = useAppData();

  const today = toISODate();
  const [weightOpen, setWeightOpen] = useState(false);
  const [weightDraft, setWeightDraft] = useState<number | null>(null);
  const [savingWeight, setSavingWeight] = useState(false);
  const [detailPlan, setDetailPlan] = useState<TrainingPlan | null>(null);

  const metric = useMemo(() => bodyMetrics.find((m) => m.date === today) ?? null, [bodyMetrics, today]);
  const todayLog = useMemo(() => dailyLogs.find((d) => d.date === today) ?? null, [dailyLogs, today]);
  const summaryProgress = useMemo(() => dailyProgress(todayLog), [todayLog]);
  const plan = useMemo(() => pickTodayPlan(plans, today), [plans, today]);
  const latestWeight = useMemo(() => {
    const list = bodyMetrics
      .filter((m) => m.weightKg != null)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return list.length ? list[list.length - 1] : null;
  }, [bodyMetrics]);
  const weekSummaries = useMemo(
    () => summaries.filter((s) => dayDiff(today, s.date) >= 0 && dayDiff(today, s.date) < 7),
    [summaries, today],
  );
  const weekVolume = weekSummaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0);
  const weekDurationSec = weekSummaries.reduce((n, s) => n + (s.totalDurationSec || 0), 0);
  const allStats = useMemo(() => allTimeStats(summaries), [summaries]);
  const streak = useMemo(() => computeStreak(summaries, today), [summaries, today]);
  const recent = useMemo(
    () => [...summaries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3),
    [summaries],
  );

  const liveActive = liveSession != null && (liveSession.status === 'active' || liveSession.status === 'paused');
  const progress = liveActive && liveSession ? sessionProgress(liveSession) : null;
  /** 进行中训练的已用时长（基于时间戳，锁屏后回来也准确） */
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveActive) return;
    const id = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveActive]);
  const liveElapsedSec = liveActive && liveSession ? elapsedSec(liveSession, liveNow) : 0;

  /** 重新开始：丢弃当前进度，用今天的计划重新建一个会话（会二次确认） */
  const [restartOpen, setRestartOpen] = useState(false);
  async function restartTraining(_target: TrainingPlan) {
    setRestartOpen(true);
  }
  async function confirmRestart() {
    if (!plan) return;
    const session = buildLiveSession(plan, { defaultRestSec: settings.defaultRestSec });
    await setLiveSession(session);
    setRestartOpen(false);
    toast('已重新开始今天的训练', 'success');
    navigate('/live');
  }
  const currentWeight = metric?.weightKg ?? latestWeight?.weightKg ?? null;
  const targetWeight = settings.bodyWeightGoalKg ?? null;

  async function startTraining() {
    if (!plan) {
      toast('还没有训练计划，先导入或新建一个计划', 'error');
      navigate('/train');
      return;
    }
    if (liveActive && liveSession) {
      navigate('/live');
      return;
    }
    const session = buildLiveSession(plan, { defaultRestSec: settings.defaultRestSec });
    await setLiveSession(session);
    toast('训练开始，加油！', 'success');
    navigate('/live');
  }

  async function saveWeight() {
    if (savingWeight) return;
    if (weightDraft == null) {
      toast('请输入体重', 'error');
      return;
    }
    setSavingWeight(true);
    try {
      await saveBodyMetric({ date: today, weightKg: weightDraft });
      toast('体重已保存', 'success');
      setWeightOpen(false);
    } finally {
      setSavingWeight(false);
    }
  }

  if (!ready) {
    return (
      <Page title="我的训练">
        <div className="skeleton" style={{ height: 120, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </Page>
    );
  }

  return (
    <Page
      title="我的训练"
      sub={`${formatDateCN(today)} · ${greeting()}`}
      right={
        streak > 0 ? (
          <Chip tone="orange">
            <IconFlame width={13} height={13} /> {streak} 天
          </Chip>
        ) : null
      }
    >
      <CleanupBanner />
      {/* 今天练什么（首屏最重要的一块） */}
      <Card className="page-enter hero-training" data-testid="today-hero">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="small muted">今天练什么</div>
            <div
              className="exercise-name"
              style={{ fontSize: 21, marginTop: 2 }}
              data-testid="today-plan-title"
            >
              {liveActive && liveSession
                ? `${KIND_EMOJI[liveSession.kind]} ${liveSession.planTitle}`
                : plan
                  ? `${KIND_EMOJI[plan.kind]} ${plan.title}`
                  : '今天还没有安排'}
            </div>
          </div>
          {liveActive && <Chip tone="orange">进行中</Chip>}
        </div>

        {liveActive && liveSession && progress ? (
          <div className="stat-grid three" style={{ marginTop: 12 }}>
            <Stat label="已完成" value={`${progress.doneSets}/${progress.plannedSets}`} unit="组" />
            <Stat label="动作" value={`${progress.index + 1}/${progress.total}`} />
            <Stat
              label="已训练"
              value={formatDurationCN(liveElapsedSec)}
            />
          </div>
        ) : plan ? (
          <div className="stat-grid three" style={{ marginTop: 12 }}>
            <Stat
              label="预计时长"
              value={plan.estimatedMinutes ? `${plan.estimatedMinutes}` : '—'}
              unit={plan.estimatedMinutes ? '分钟' : undefined}
            />
            <Stat label="动作" value={plan.exercises.length} unit="个" />
            <Stat label="热身" value={plan.warmup.length} unit="项" />
          </div>
        ) : null}

        {plan && !liveActive && (
          <div style={{ marginTop: 10 }}>
            {plan.exercises.slice(0, 3).map((ex) => (
              <div key={ex.id} className="home-ex-row">
                <span className="truncate" style={{ fontWeight: 550 }}>
                  {ex.name}
                </span>
                <span className="tiny muted nowrap">{targetSummary(ex.target)}</span>
              </div>
            ))}
            {plan.exercises.length > 3 && (
              <div className="tiny muted" style={{ paddingTop: 4 }}>
                还有 {plan.exercises.length - 3} 个动作
              </div>
            )}
          </div>
        )}

        {plan || liveActive ? (
          <>
            <Button
              variant="primary"
              size="xl"
              block
              style={{ marginTop: 14 }}
              onClick={() => void startTraining()}
              data-testid="start-training"
            >
              <IconPlay width={24} height={24} style={{ marginRight: 8 }} />
              {liveActive && progress
                ? `继续训练（${progress.doneSets}/${progress.plannedSets} 组）`
                : '开始训练'}
            </Button>
            {liveActive && plan && (
              <Button
                block
                size="lg"
                style={{ marginTop: 10 }}
                data-testid="restart-training"
                onClick={() => void restartTraining(plan)}
              >
                重新开始这个计划
              </Button>
            )}
            {plan && (
              <button
                className="tiny muted center"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => setDetailPlan(plan)}
              >
                查看完整计划（{plan.exercises.length} 个动作）›
              </button>
            )}
          </>
        ) : (
          <div className="col" style={{ gap: 10, marginTop: 14 }}>
            <PdfImportButton
              variant="primary"
              size="lg"
              block
              label="导入 ChatGPT PDF 计划"
              testId="import-pdf-empty"
            />
            <Button block size="lg" onClick={() => navigate('/train')}>
              手动新建训练计划
            </Button>
            <div className="tiny muted center">
              导入或新建后，这里会显示预计时长和开始训练按钮
            </div>
          </div>
        )}
      </Card>

      {/* 今日状态 */}
      <Card className="page-enter">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <div className="small muted">今日状态</div>
            <div className="strong" style={{ fontSize: 17, marginTop: 2 }}>
              {metric?.recovery != null ? `恢复 ${metric.recovery}/5` : '还没有今日记录'}
            </div>
          </div>
          <button
            className="weight-pill"
            onClick={() => {
              setWeightDraft(currentWeight);
              setWeightOpen(true);
            }}
            aria-label="记录体重"
          >
            <span className="small muted">体重</span>
            <span className="strong">{currentWeight != null ? `${formatNumber(currentWeight)} kg` : '记录'}</span>
          </button>
        </div>
        <div className="stat-grid three">
          <Stat label="睡眠" value={metric?.sleepHours != null ? formatNumber(metric.sleepHours) : '—'} unit="h" />
          <Stat label="酸痛" value={metric?.soreness != null ? `${metric.soreness}/5` : '—'} />
          <Stat label="恢复" value={metric?.recovery != null ? `${metric.recovery}/5` : '—'} />
        </div>
      </Card>

      {/* 恢复状态 */}
      <SectionTitle>恢复状态</SectionTitle>
      <Card>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <Ring progress={metric?.recovery != null ? metric.recovery / 5 : 0} size={110} stroke={10}>
            <div style={{ textAlign: 'center' }}>
              <div className="strong" style={{ fontSize: 24 }}>
                {metric?.recovery != null ? metric.recovery : '—'}
              </div>
              <div className="tiny muted">恢复</div>
            </div>
          </Ring>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small muted">
              {recoveryAdvice(
                metric?.sleepHours ?? todayLog?.sleepHours ?? null,
                metric?.soreness ?? null,
                metric?.recovery ?? null,
              )}
            </div>
            <div className="wrap" style={{ gap: 6, marginTop: 10 }}>
              <Chip>{todayLog?.supplements?.proteinG ? `蛋白 ${todayLog.supplements.proteinG}g` : '蛋白未记录'}</Chip>
              <Chip>{metric?.waterMl ? `饮水 ${metric.waterMl}ml` : '饮水未记录'}</Chip>
            </div>
            <Button size="sm" style={{ marginTop: 12 }} onClick={() => navigate('/data')}>
              记录今日身体数据
            </Button>
          </div>
        </div>
      </Card>

      {/* 今日总结完成度 */}
      <SectionTitle action="去填写" onAction={() => navigate('/summary')}>
        今日总结
      </SectionTitle>
      <div data-testid="home-summary-progress">
      <Card onClick={() => navigate('/summary')}>
        <div className="row-between">
          <div>
            <div className="small muted">今日记录完成度</div>
            <div className="strong" style={{ fontSize: 22 }}>
              {Math.round(summaryProgress.ratio * 100)}%
            </div>
          </div>
          <Chip tone={summaryProgress.ratio >= 0.6 ? 'green' : summaryProgress.hasAny ? 'orange' : 'default'}>
            {summaryProgress.hasAny ? `${summaryProgress.filled}/${summaryProgress.total} 项` : '还没有记录'}
          </Chip>
        </div>
        <div className="bar" style={{ marginTop: 10 }}>
          <i style={{ width: `${Math.max(3, Math.round(summaryProgress.ratio * 100))}%` }} />
        </div>
        <div className="wrap" style={{ gap: 6, marginTop: 10 }}>
          {summaryProgress.sections.map((s) => (
            <Chip key={s.key} tone={s.filled > 0 ? 'accent' : 'default'}>
              {s.emoji} {s.label.split(' ')[0]} {s.filled}/{s.total}
            </Chip>
          ))}
        </div>
        <div className="tiny muted" style={{ marginTop: 10 }}>
          记录训练、Apple Watch、睡眠、身体与饮食数据，之后可以一键导出给 ChatGPT 分析。
        </div>
      </Card>
      </div>

      {/* 数据速览 */}
      <SectionTitle action="全部数据" onAction={() => navigate('/data')}>
        本周速览
      </SectionTitle>
      <div className="stat-grid">
        <Card flat>
          <div className="small muted">本周训练</div>
          <div className="strong" style={{ fontSize: 26, marginTop: 4 }}>
            {weekSummaries.length}
            <span className="unit"> 次</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            目标 {settings.weeklyFrequencyGoal ?? 5} 次
          </div>
        </Card>
        <Card flat>
          <div className="small muted">本周训练时长</div>
          <div className="strong" style={{ fontSize: 26, marginTop: 4 }}>
            {weekDurationSec > 0 ? formatDurationCN(weekDurationSec) : '—'}
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {weekVolume > 0 ? `容量 ${formatVolume(weekVolume)}` : '完成训练后自动统计'}
          </div>
        </Card>
      </div>
      <Card flat>
        <div className="row-between">
          <div>
            <div className="small muted">累计训练</div>
            <div className="strong" style={{ fontSize: 24, marginTop: 4 }}>
              {allStats.sessions}
              <span className="unit"> 次</span>
              <span className="muted" style={{ fontSize: 15, marginLeft: 8 }}>
                {allStats.durationSec > 0 ? formatDurationCN(allStats.durationSec) : '—'}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">连续打卡</div>
            <div className="strong" style={{ fontSize: 22, marginTop: 4 }}>
              {streak}
              <span className="unit"> 天</span>
            </div>
          </div>
        </div>
        {allStats.sessions === 0 && (
          <div className="tiny muted" style={{ marginTop: 6 }}>
            完成第一次训练后，这里会显示累计次数与时长
          </div>
        )}
      </Card>

      {targetWeight != null && currentWeight != null && (
        <Card>
          <div className="row-between">
            <div className="row" style={{ gap: 8 }}>
              <IconTrophy width={18} height={18} />
              <span className="strong">体重目标</span>
            </div>
            <span className="muted small">
              目标 {formatNumber(targetWeight)} kg · 当前 {formatNumber(currentWeight)} kg
            </span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <i
              style={{
                width: `${Math.min(
                  100,
                  Math.max(6, 100 - Math.abs(currentWeight - targetWeight) * 10),
                )}%`,
              }}
            />
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            还差 {formatNumber(Math.abs(currentWeight - targetWeight))} kg
          </div>
        </Card>
      )}

      {/* 导入 PDF */}
      <SectionTitle>导入 ChatGPT PDF</SectionTitle>
      <PdfDropZone label="把 ChatGPT 生成的训练 PDF 拖到这里，或点击选择文件" testId="import-pdf" />

      {/* 最近训练 */}
      <SectionTitle action="全部记录" onAction={() => navigate('/history')}>
        最近训练
      </SectionTitle>
      {recent.length > 0 ? (
        <div className="list">
          {recent.map((s) => (
            <ListRow
              key={s.id}
              title={`${KIND_EMOJI[s.kind]} ${s.planTitle}`}
              sub={`${formatDateShort(s.date)} · ${Math.round(s.completionRate * 100)}% 完成 · ${s.totalSets} 组`}
              value={
                kindIsCardio(s.kind)
                  ? s.cardio[0]?.distanceKm
                    ? `${formatNumber(s.cardio[0].distanceKm, 2)} km`
                    : '—'
                  : formatVolume(s.totalVolumeKg)
              }
              onClick={() => navigate('/history')}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState emoji="🏃" title="还没有训练记录" desc="完成一次训练后会自动生成总结" />
        </Card>
      )}

      {/* 体重快速记录 */}
      <Sheet
        open={weightOpen}
        onClose={() => setWeightOpen(false)}
        title="记录今日体重"
        footer={
          <Button block variant="primary" size="lg" onClick={() => void saveWeight()} disabled={savingWeight}>
            {savingWeight ? '保存中…' : '保存'}
          </Button>
        }
      >
        <div className="field">
          <span className="field-label">体重（kg）</span>
          <NumberInput value={weightDraft} onChange={setWeightDraft} placeholder="例如 68.5" testId="weight-input" />
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {formatDateCN(today)} · 只保存在本机，不会上传
        </div>
      </Sheet>

      {/* 计划详情 */}
      <Sheet
        open={detailPlan != null}
        onClose={() => setDetailPlan(null)}
        title={detailPlan?.title ?? '计划详情'}
        footer={
          detailPlan && (
            <div className="col" style={{ gap: 10 }}>
              <Button block variant="primary" size="lg" onClick={() => void startTraining()}>
                {liveActive ? '继续训练' : '开始训练'}
              </Button>
              <Button block size="lg" onClick={() => void exportPlanPdf(detailPlan).catch(() => toast('导出失败', 'error'))}>
                导出计划 PDF
              </Button>
            </div>
          )
        }
      >
        {detailPlan && (
          <div>
            {detailPlan.warmup.length > 0 && (
              <>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  热身
                </div>
                <ul className="detail-list">
                  {detailPlan.warmup.map((w) => (
                    <li key={w.name}>
                      {w.name}
                      {w.detail ? ` · ${w.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="small muted" style={{ margin: '12px 0 6px' }}>
              训练动作
            </div>
            <div className="col" style={{ gap: 8 }}>
              {detailPlan.exercises.map((ex, i) => (
                <div key={ex.id} className="detail-ex">
                  <div className="strong">
                    {i + 1}. {ex.name}
                  </div>
                  <div className="tiny muted">{targetSummary(ex.target)}</div>
                  {ex.cue && <div className="tiny" style={{ marginTop: 4 }}>要领：{ex.cue}</div>}
                  {ex.notes && (
                    <div className="tiny" style={{ marginTop: 2, color: 'var(--orange)' }}>
                      注意：{ex.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {detailPlan.cooldown && (
              <>
                <div className="small muted" style={{ margin: '12px 0 6px' }}>
                  拉伸与恢复
                </div>
                <div className="small">{detailPlan.cooldown}</div>
              </>
            )}
            {detailPlan.notes && (
              <>
                <div className="small muted" style={{ margin: '12px 0 6px' }}>
                  备注
                </div>
                <div className="small">{detailPlan.notes}</div>
              </>
            )}
          </div>
        )}
      </Sheet>

      <Confirm
        open={restartOpen}
        title="重新开始今天的训练？"
        message={
          progress
            ? `当前进度（已完成 ${progress.doneSets}/${progress.plannedSets} 组）会被清除，改用今天的计划从头开始。这一步无法撤销。`
            : ''
        }
        confirmText="重新开始"
        danger
        onCancel={() => setRestartOpen(false)}
        onConfirm={() => void confirmRestart()}
      />
    </Page>
  );
}
