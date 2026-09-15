/**
 * 总结（底部导航一级页面）
 * 1) 今日记录：每天一份原始数据（训练 / Apple Watch / 睡眠 / 身体 / 饮食 / 自由记录），输入即自动保存
 * 2) 我的每日记录：日历 + 列表两种视图，按日期范围筛选，可编辑 / 删除 / 复制
 * 3) ChatGPT 分析报告：导入 PDF 报告并按日期范围与原始记录对照（与每日原始记录分开保存）
 * 顶部提供「一键导出给 ChatGPT」（PDF / Markdown / JSON / 纯文本）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Page } from '../components/Page';
import {
  Button,
  Card,
  Chip,
  Confirm,
  EmptyState,
  Field,
  SectionTitle,
  Segmented,
  Sheet,
  TextInput,
  useToast,
} from '../components/ui';
import { IconShare, IconTrash } from '../components/icons';
import { SummaryForm } from '../components/summary/SummaryForm';
import { SummaryWizard } from '../components/summary/SummaryWizard';
import { ExportDialog } from '../components/summary/ExportDialog';
import { ImportChatGptReportButton } from '../components/ImportChatGptReportButton';
import { ReportArchiveCard } from '../components/summary/ReportArchiveCard';
import { DayAttachmentsCard } from '../components/summary/DayAttachmentsCard';
import { useAppData } from '../state/AppData';
import {
  KIND_EMOJI,
  addDays,
  dayDiff,
  formatDateCN,
  formatDateShort,
  formatDurationCN,
  formatVolume,
  parseISODate,
  toISODate,
} from '../lib/format';
import { dailyLogHeadline, dailyProgress } from '../lib/summary/sections';
import type { ChatGptReport, DailyLog, ISODate, WorkoutSummary } from '../types';

type Tab = 'today' | 'records' | 'chatgpt';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function dayList(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const diff = dayDiff(end, start);
  for (let i = 0; i <= diff; i += 1) out.push(addDays(start, i));
  return out;
}

/** 简易月历：显示哪些日期有记录 */
function MonthCalendar({
  month,
  onMonthChange,
  hasRecord,
  selected,
  onSelect,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  hasRecord: (date: ISODate) => boolean;
  selected: ISODate;
  onSelect: (date: ISODate) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startOffset = new Date(y, m - 1, 1).getDay();
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => `${month}-${`${i + 1}`.padStart(2, '0')}` as ISODate,
    ),
  ];
  const today = toISODate();

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1);
    onMonthChange(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`);
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <Button size="sm" onClick={() => shift(-1)}>
          ‹ 上月
        </Button>
        <span className="strong">
          {y} 年 {m} 月
        </span>
        <Button size="sm" onClick={() => shift(1)}>
          下月 ›
        </Button>
      </div>
      <div className="cal-head">
        {WEEKDAY.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} className="cal-cell empty" />;
          const filled = hasRecord(date);
          return (
            <button
              key={date}
              className={`cal-cell ${filled ? 'filled' : ''} ${
                date === today ? 'today' : ''
              } ${date === selected ? 'selected' : ''}`}
              onClick={() => onSelect(date)}
              data-testid={`cal-${date}`}
            >
              <span>{Number(date.slice(-2))}</span>
              {filled && <i className="cal-dot" />}
            </button>
          );
        })}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        有蓝点的日期表示当天已有记录；点日期可直接编辑。
      </div>
    </div>
  );
}

export default function SummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const {
    ready,
    dailyLogs,
    summaries,
    chatGptReports,
    saveDailyLog,
    deleteDailyLog,
    copyDailyLog,
    deleteChatGptReport,
    renameChatGptReport,
    loadReportPdf,
  } = useAppData();

  const today = toISODate();
  const tab = ((params.get('tab') as Tab) ?? 'today') as Tab;
  const dateParam = params.get('date');
  const activeDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? (dateParam as ISODate) : today;

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRange, setExportRange] = useState({ start: today, end: today });
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<ISODate>(addDays(activeDate, 1));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [rangeStart, setRangeStart] = useState<ISODate>(addDays(today, -6));
  const [rangeEnd, setRangeEnd] = useState<ISODate>(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<ChatGptReport | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /** 高级模式：直接编辑全部字段（默认走逐步引导） */
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const s = params.get('start');
    const e = params.get('end');
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) setRangeStart(s as ISODate);
    if (e && /^\d{4}-\d{2}-\d{2}$/.test(e)) setRangeEnd(e as ISODate);
  }, [params]);

  const setTab = useCallback(
    (next: Tab) => {
      const p = new URLSearchParams(params);
      p.set('tab', next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const setActiveDate = useCallback(
    (next: ISODate) => {
      const p = new URLSearchParams(params);
      p.set('date', next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  /** 打开某一天：日期和 tab 一起改，避免两次 setParams 互相覆盖导致跳到"今天" */
  const openDay = useCallback(
    (next: ISODate) => {
      const p = new URLSearchParams(params);
      p.set('date', next);
      p.set('tab', 'today');
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const logByDate = useMemo(() => {
    const map = new Map<string, DailyLog>();
    dailyLogs.forEach((d) => map.set(d.date, d));
    return map;
  }, [dailyLogs]);

  const summaryByDate = useMemo(() => {
    const map = new Map<string, WorkoutSummary[]>();
    summaries.forEach((s) => map.set(s.date, [...(map.get(s.date) ?? []), s]));
    return map;
  }, [summaries]);

  const activeLog = logByDate.get(activeDate) ?? null;
  const activeSummary = summaryByDate.get(activeDate)?.[0] ?? null;
  const activeProgress = dailyProgress(activeLog);

  const rangeDays = useMemo(() => {
    const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
    const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
    return dayList(start, end);
  }, [rangeStart, rangeEnd]);

  const reportsSorted = useMemo(
    () => [...chatGptReports].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [chatGptReports],
  );

  if (!ready) {
    return (
      <Page title="今日总结">
        <div className="skeleton" style={{ height: 220 }} />
      </Page>
    );
  }

  return (
    <Page
      title="今日总结"
      sub={tab === 'today' ? formatDateCN(activeDate) : '记录原始数据，导出给 ChatGPT 分析'}
      right={
        <button className="icon-btn" aria-label="选择日期" onClick={() => setCalendarOpen(true)}>
          📅
        </button>
      }
    >
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'today', label: '今日记录' },
          { value: 'records', label: '我的每日记录' },
          { value: 'chatgpt', label: 'ChatGPT 报告' },
        ]}
      />

      <Button
        block
        size="lg"
        variant="primary"
        style={{ marginTop: 12 }}
        data-testid="open-export"
        onClick={() => {
          setExportRange(
            tab === 'today'
              ? { start: activeDate, end: activeDate }
              : { start: rangeStart, end: rangeEnd },
          );
          setExportOpen(true);
        }}
      >
        <IconShare width={18} height={18} style={{ marginRight: 6 }} />
        一键导出给 ChatGPT
      </Button>

      {/* ---------------- 1) 今日记录 ---------------- */}
      {tab === 'today' && (
        <div style={{ marginTop: 14 }}>
          <Card flat>
            <div>
              <div className="small muted">记录日期</div>
              <div className="strong" style={{ fontSize: 17 }}>
                {formatDateCN(activeDate)}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              <Button size="sm" onClick={() => setActiveDate(addDays(activeDate, -1))}>
                ‹ 前一天
              </Button>
              <Button size="sm" disabled={activeDate === today} onClick={() => setActiveDate(today)}>
                今天
              </Button>
              <Button
                size="sm"
                disabled={activeDate >= today}
                onClick={() => setActiveDate(addDays(activeDate, 1))}
              >
                后一天 ›
              </Button>
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              {activeProgress.hasAny
                ? `已填写 ${activeProgress.filled}/${activeProgress.total} 项，自动保存中`
                : '这一天还没有记录，填写任意一项就会自动保存'}
            </div>
          </Card>

          {activeSummary && (
            <Card>
              <div className="row-between">
                <span className="strong">
                  {KIND_EMOJI[activeSummary.kind]} {activeSummary.planTitle}
                </span>
                <Chip tone="green">完成 {Math.round(activeSummary.completionRate * 100)}%</Chip>
              </div>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {formatDurationCN(activeSummary.totalDurationSec)} · 容量{' '}
                {formatVolume(activeSummary.totalVolumeKg)} · {activeSummary.totalSets} 组
              </div>
              <div className="row" style={{ gap: 10, marginTop: 10 }}>
                <Button size="sm" onClick={() => navigate('/history')}>
                  查看训练报告
                </Button>
                <Button
                  size="sm"
                  data-testid="fill-from-workout"
                  onClick={async () => {
                    const existing = activeLog?.training ?? {};
                    await saveDailyLog({
                      date: activeDate,
                      training: {
                        ...existing,
                        kind: activeSummary.kind,
                        items: existing.items || activeSummary.planTitle,
                        exercises:
                          existing.exercises ||
                          activeSummary.completedExercises.join('、'),
                        durationMin:
                          existing.durationMin ??
                          Math.round(activeSummary.totalDurationSec / 60),
                        rpe: existing.rpe ?? activeSummary.rpe ?? null,
                        completionPct:
                          existing.completionPct ??
                          Math.round(activeSummary.completionRate * 100),
                        volumeKg: existing.volumeKg ?? activeSummary.totalVolumeKg,
                        feeling: existing.feeling || activeSummary.feeling || '',
                        painSites:
                          existing.painSites?.length
                            ? existing.painSites
                            : (activeSummary.painSites ?? []),
                      },
                    });
                    toast('已从训练记录带入，可继续补充', 'success');
                  }}
                >
                  从训练记录带入
                </Button>
              </div>
            </Card>
          )}

          {/* 默认走逐步引导；需要一次改很多项时可以切到完整表单 */}
          <ReportArchiveCard log={activeLog} date={activeDate} />
          <DayAttachmentsCard log={activeLog} date={activeDate} />

          {advanced ? (
            <>
              <div className="row-between" style={{ margin: '4px 0 8px' }}>
                <span className="small muted">完整表单（所有字段一次显示）</span>
                <Button size="sm" onClick={() => setAdvanced(false)} data-testid="summary-back-wizard">
                  返回逐步引导
                </Button>
              </div>
              <SummaryForm
                date={activeDate}
                log={activeLog}
                onCopyRequest={() => {
                  setCopyTarget(addDays(activeDate, 1));
                  setCopyOpen(true);
                }}
                onExportRequest={() => {
                  setExportRange({ start: activeDate, end: activeDate });
                  setExportOpen(true);
                }}
                onDeleted={() => setActiveDate(today)}
              />
            </>
          ) : (
            <SummaryWizard
              date={activeDate}
              log={activeLog}
              onOpenAdvanced={() => setAdvanced(true)}
              onFinalized={() => toast('今日总结已归档，可以继续训练或休息了', 'success')}
            />
          )}
        </div>
      )}

      {/* ---------------- 2) 我的每日记录 ---------------- */}
      {tab === 'records' && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="strong">查看方式</span>
              <Segmented<'list' | 'calendar'>
                value={view}
                onChange={setView}
                options={[
                  { value: 'list', label: '列表' },
                  { value: 'calendar', label: '日历' },
                ]}
              />
            </div>
            {view === 'list' ? (
              <>
                <div className="form-row">
                  <div className="grow">
                    <Field label="开始日期">
                      <input
                        className="input"
                        type="date"
                        value={rangeStart}
                        data-testid="records-start"
                        onChange={(e) => setRangeStart(e.target.value as ISODate)}
                      />
                    </Field>
                  </div>
                  <div className="grow">
                    <Field label="结束日期">
                      <input
                        className="input"
                        type="date"
                        value={rangeEnd}
                        data-testid="records-end"
                        onChange={(e) => setRangeEnd(e.target.value as ISODate)}
                      />
                    </Field>
                  </div>
                </div>
                <div className="wrap" style={{ gap: 6, marginTop: 10 }}>
                  {[1, 3, 7, 10, 30].map((n) => (
                    <button
                      key={n}
                      className="chip"
                      onClick={() => {
                        setRangeEnd(today);
                        setRangeStart(addDays(today, -(n - 1)));
                      }}
                    >
                      最近 {n} 天
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <MonthCalendar
                month={month}
                onMonthChange={setMonth}
                hasRecord={(d) => logByDate.has(d) || summaryByDate.has(d)}
                selected={activeDate}
                onSelect={(d) => openDay(d)}
              />
            )}
          </Card>

          {view === 'list' && (
            <Card>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="strong">
                  共 {rangeDays.length} 天 · 已记录{' '}
                  {rangeDays.filter((d) => logByDate.has(d) || summaryByDate.has(d)).length} 天
                </span>
                <Chip tone="orange">
                  缺失 {rangeDays.filter((d) => !logByDate.has(d) && !summaryByDate.has(d)).length} 天
                </Chip>
              </div>
              {rangeDays.map((d) => {
                const log = logByDate.get(d) ?? null;
                const sum = summaryByDate.get(d)?.[0];
                const empty = !log && !sum;
                const p = dailyProgress(log);
                return (
                  <div key={d} className="day-row" data-testid={`day-row-${d}`}>
                    <button
                      className="day-main"
                      onClick={() => openDay(d)}
                    >
                      <span className="day-date">
                        {formatDateShort(d)}
                        <span className="tiny muted"> 周{WEEKDAY[parseISODate(d).getDay()]}</span>
                      </span>
                      <span className={`day-summary ${empty ? 'muted' : ''}`}>
                        {empty ? '未记录' : dailyLogHeadline(log)}
                        {sum ? ` · 训练 ${sum.planTitle}` : ''}
                      </span>
                      <span className="tiny muted nowrap">
                        {empty ? '' : `${Math.round(p.ratio * 100)}%`}
                      </span>
                    </button>
                    <div className="day-actions">
                      <button
                        aria-label={`复制 ${d}`}
                        onClick={() => {
                          setActiveDate(d);
                          setCopyTarget(addDays(d, 1));
                          setCopyOpen(true);
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        aria-label={`删除 ${d}`}
                        className="danger"
                        onClick={() => setConfirmTarget(d)}
                      >
                        <IconTrash width={15} height={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <Button block onClick={() => navigate('/history')}>
            查看训练历史与训练报告 PDF
          </Button>
          <Card>
            <div className="strong" style={{ marginBottom: 6 }}>
              导入历史报告
            </div>
            <div className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
              把之前用 ChatGPT 整理的每日总结 PDF 导入成正式记录（按报告日期归档，训练 / Apple Watch /
              睡眠 / 补剂会写进对应字段，原文与原始 PDF 一起保存；同一天只补空字段，不覆盖已有内容）。
            </div>
            <Button
              block
              size="lg"
              data-testid="open-history-import"
              onClick={() => navigate('/import/history')}
            >
              导入历史报告（需要导入码）
            </Button>
          </Card>
        </div>
      )}

      {/* ---------------- 3) ChatGPT 分析报告 ---------------- */}
      {tab === 'chatgpt' && (
        <div style={{ marginTop: 14 }}>
          <Card>
            <div className="strong" style={{ marginBottom: 6 }}>
              导入 ChatGPT 生成的报告
            </div>
            <div className="tiny muted" style={{ marginBottom: 10 }}>
              支持 1 天 / 3 天 / 5 天 / 7 天 / 10 天或任意日期范围的分析报告；解析后先预览再保存，
              不会覆盖你每天填写的原始记录。
            </div>
            <ImportChatGptReportButton block size="lg" />
          </Card>

          <SectionTitle>{`已保存的报告（${reportsSorted.length}）`}</SectionTitle>
          {reportsSorted.length === 0 ? (
            <Card>
              <EmptyState
                emoji="🧠"
                title="还没有导入过 ChatGPT 报告"
                desc="导入后可按日期范围与原始记录对照查看，也可以重命名和删除"
              />
            </Card>
          ) : (
            <Card>
              {reportsSorted.map((r) => (
                <button
                  key={r.id}
                  className="report-row"
                  data-testid={`report-row-${r.id}`}
                  onClick={() => {
                    setDetailReport(r);
                    setRenameValue(r.title);
                  }}
                >
                  <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                    <span className="strong truncate" style={{ display: 'block' }}>
                      {r.title}
                    </span>
                    <span className="tiny muted">
                      {r.startDate} ~ {r.endDate} ·{' '}
                      {r.startDate === r.endDate
                        ? '单日'
                        : `${dayDiff(r.endDate, r.startDate) + 1} 天`}
                      {r.tags.length ? ` · ${r.tags.join(' / ')}` : ''}
                    </span>
                  </span>
                  <span className="chev">›</span>
                </button>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ---------------- 弹层：日期选择 ---------------- */}
      <Sheet open={calendarOpen} onClose={() => setCalendarOpen(false)} title="选择日期">
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          hasRecord={(d) => logByDate.has(d) || summaryByDate.has(d)}
          selected={activeDate}
          onSelect={(d) => {
            openDay(d);
            setCalendarOpen(false);
          }}
        />
      </Sheet>

      {/* ---------------- 弹层：复制到其他日期 ---------------- */}
      <Sheet open={copyOpen} onClose={() => setCopyOpen(false)} title="复制到其他日期">
        <Field label="目标日期">
          <input
            className="input"
            type="date"
            value={copyTarget}
            data-testid="copy-target"
            onChange={(e) => setCopyTarget(e.target.value as ISODate)}
          />
        </Field>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          复制的只是填写内容（不含截图附件）；目标日期已有记录时会合并更新，不会产生重复条目。
        </div>
        <Button
          block
          size="lg"
          variant="primary"
          style={{ marginTop: 12 }}
          data-testid="copy-confirm"
          onClick={async () => {
            try {
              await copyDailyLog(activeDate, copyTarget);
              toast(`已复制到 ${copyTarget}`, 'success');
              setCopyOpen(false);
              setActiveDate(copyTarget);
            } catch (err) {
              toast(err instanceof Error ? err.message : '复制失败', 'error');
            }
          }}
        >
          确认复制
        </Button>
      </Sheet>

      {/* ---------------- 弹层：报告详情 ---------------- */}
      <Sheet
        open={detailReport !== null}
        onClose={() => setDetailReport(null)}
        title={detailReport?.title ?? '分析报告'}
      >
        {detailReport && (
          <div>
            <div className="wrap" style={{ gap: 6 }}>
              <Chip tone="purple">
                {detailReport.startDate} ~ {detailReport.endDate}
              </Chip>
              {detailReport.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
            {detailReport.parseWarnings?.length ? (
              <div className="tiny muted" style={{ marginTop: 8 }}>
                解析提示：{detailReport.parseWarnings.join('；')}
              </div>
            ) : null}

            <Field label="重命名">
              <TextInput value={renameValue} onChange={setRenameValue} />
            </Field>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={async () => {
                await renameChatGptReport(detailReport.id, renameValue);
                setDetailReport({ ...detailReport, title: renameValue });
                toast('已重命名', 'success');
              }}
            >
              保存名称
            </Button>

            <div className="report-body">
              {detailReport.summaryText && (
                <>
                  <div className="strong" style={{ marginTop: 14 }}>
                    报告摘要
                  </div>
                  <p className="small">{detailReport.summaryText}</p>
                </>
              )}
              {detailReport.evaluation && (
                <>
                  <div className="strong" style={{ marginTop: 12 }}>
                    ChatGPT 的评价
                  </div>
                  <p className="small">{detailReport.evaluation}</p>
                </>
              )}
              {detailReport.suggestions && (
                <>
                  <div className="strong" style={{ marginTop: 12 }}>
                    建议
                  </div>
                  <p className="small">{detailReport.suggestions}</p>
                </>
              )}
              {detailReport.risks && (
                <>
                  <div className="strong" style={{ marginTop: 12 }}>
                    风险提醒
                  </div>
                  <p className="small" style={{ color: 'var(--orange)' }}>
                    {detailReport.risks}
                  </p>
                </>
              )}
              <div className="strong" style={{ marginTop: 12 }}>
                完整报告
              </div>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                {detailReport.bodyText}
              </p>
              {detailReport.note && (
                <>
                  <div className="strong" style={{ marginTop: 12 }}>
                    我的备注
                  </div>
                  <p className="small">{detailReport.note}</p>
                </>
              )}
            </div>

            <div className="col" style={{ gap: 10, marginTop: 14 }}>
              <Button
                block
                variant="primary"
                size="lg"
                data-testid="report-view-records"
                onClick={() => {
                  setRangeStart(detailReport.startDate);
                  setRangeEnd(detailReport.endDate);
                  setView('list');
                  setTab('records');
                  setDetailReport(null);
                }}
              >
                查看该时间段的原始记录
              </Button>
              <Button
                block
                onClick={async () => {
                  const blob = detailReport.pdfBlob ?? (await loadReportPdf(detailReport.id));
                  if (!blob) {
                    toast('没有保存原始 PDF', 'error');
                    return;
                  }
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = detailReport.fileName ?? `${detailReport.title}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 4000);
                }}
              >
                下载原始 PDF
              </Button>
              <Button
                block
                variant="danger"
                data-testid="report-delete"
                onClick={() => setConfirmTarget(`report:${detailReport.id}`)}
              >
                删除这份报告
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* ---------------- 确认删除 ---------------- */}
      <Confirm
        open={confirmTarget !== null}
        title="确认删除？"
        message={
          confirmTarget?.startsWith('report:')
            ? `将删除分析报告「${detailReport?.title ?? ''}」，每日原始记录不受影响。`
            : `将删除 ${confirmTarget ?? ''} 的今日总结记录，操作无法撤销。`
        }
        confirmText="删除"
        danger
        onCancel={() => setConfirmTarget(null)}
        onConfirm={async () => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (!target) return;
          if (target.startsWith('report:')) {
            await deleteChatGptReport(target.slice('report:'.length));
            setDetailReport(null);
            toast('报告已删除', 'success');
            return;
          }
          await deleteDailyLog(target as ISODate);
          toast('记录已删除', 'success');
        }}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        initialStart={exportRange.start}
        initialEnd={exportRange.end}
      />
    </Page>
  );
}
