/**
 * 我的
 * 目标 / 补剂 / 备份 / 主题 / 数据管理 / PWA 安装提示
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../components/Page';
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
  TextInput,
  useToast,
} from '../components/ui';
import { IconShare, IconTrash } from '../components/icons';
import { estimateStorageSize } from '../db/db';
import {
  formatDateCN,
  formatDateShort,
  formatNumber,
  formatVolume,
  nowISO,
  toISODate,
  uid,
} from '../lib/format';
import { useAppData } from '../state/AppData';
import { useNavigate } from 'react-router-dom';
import { currentVersion } from '../lib/update/updater';
import { UpdatePanel } from '../components/UpdatePanel';
import { CleanupSheet } from '../components/CleanupSheet';
import { PDF_KIND_LABEL, type BackupFile, type Goal, type ThemeMode } from '../types';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<unknown> };

/** 备份文件里允许出现的数据分区（用于格式校验） */
const BACKUP_KEYS = [
  'plans',
  'summaries',
  'bodyMetrics',
  'dailyLogs',
  'exercises',
  'templates',
  'prs',
  'goals',
  'settings',
  'liveSession',
  'pdfImports',
  'chatGptReports',
  'attachments',
];

interface RestoreSummary {
  plans: number;
  summaries: number;
  dailyLogs: number;
  bodyMetrics: number;
  chatGptReports: number;
  attachments: number;
}

interface PendingRestore {
  file: BackupFile;
  summary: RestoreSummary;
  fileName: string;
  exportedAt: string;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ProfilePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const {
    ready,
    settings,
    saveSettings,
    goals,
    saveGoal,
    deleteGoal,
    dailyLogs,
    bodyMetrics,
    summaries,
    plans,
    exercises: library,
    templates,
    prs,
    pdfImports,
    deletePdfImport,
    buildFullBackup,
    restoreBackup,
    clearAllData,
    restoreSamples,
    attachments,
    chatGptReports,
  } = useAppData();

  const today = toISODate();
  const todayLog = useMemo(() => dailyLogs.find((d) => d.date === today) ?? null, [dailyLogs, today]);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState<number | null>(null);
  const [goalUnit, setGoalUnit] = useState('kg');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [storage, setStorage] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSamples, setConfirmSamples] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStandalone(isStandalone());
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void estimateStorageSize().then(setStorage);
  }, [ready, plans, summaries, bodyMetrics, dailyLogs, pdfImports]);

  async function exportBackup() {
    try {
      // 完整备份：包含每日总结、ChatGPT 报告文本，以及截图与原始 PDF（base64）
      const blob = await buildFullBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `我的训练-完整备份-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      await saveSettings({ lastBackupAt: nowISO() });
      toast('完整备份已导出（含截图与报告）', 'success');
    } catch (err) {
      console.error('[backup] 导出失败', err);
      toast('备份导出失败，请重试', 'error');
    }
  }

  async function onRestoreFile(file: File) {
    try {
      if (file.size > 60 * 1024 * 1024) {
        toast('备份文件超过 60MB，可能不是本应用的备份', 'error');
        return;
      }
      // 不按扩展名拦截（部分浏览器/系统不保留文件名后缀），改为按内容校验
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupFile;
      // 格式校验：必须是本应用导出的备份，且包含可识别的数据结构
      if (parsed?.app !== 'wo-de-xun-lian' || !parsed.data || typeof parsed.data !== 'object') {
        toast('这不是「我的训练」的备份文件，已停止导入', 'error');
        return;
      }
      const unknownKeys = Object.keys(parsed.data).filter(
        (k) => !BACKUP_KEYS.includes(k),
      );
      if (unknownKeys.length === Object.keys(parsed.data).length) {
        toast('备份内容无法识别，已停止导入', 'error');
        return;
      }
      const summary = {
        plans: parsed.data.plans?.length ?? 0,
        summaries: parsed.data.summaries?.length ?? 0,
        dailyLogs: parsed.data.dailyLogs?.length ?? 0,
        bodyMetrics: parsed.data.bodyMetrics?.length ?? 0,
        chatGptReports: parsed.data.chatGptReports?.length ?? 0,
        attachments:
          (parsed as unknown as { attachmentFiles?: unknown[] }).attachmentFiles?.length ??
          parsed.data.attachments?.length ??
          0,
      };
      setPendingRestore({ file: parsed, summary, fileName: file.name, exportedAt: parsed.exportedAt });
      setRestoreOpen(true);
    } catch (err) {
      console.error('[backup] 解析失败', err);
      toast(
        err instanceof Error && err.name === 'SyntaxError'
          ? '备份文件已损坏（不是有效的 JSON）'
          : '备份文件无法读取，请确认文件完整',
        'error',
      );
    }
  }

  async function installApp() {
    if (installEvent) {
      await installEvent.prompt();
      setInstallEvent(null);
      return;
    }
    toast('请按下面的步骤从 Safari 添加到主屏幕');
  }

  async function addGoal() {
    const title = goalTitle.trim();
    if (!title) {
      toast('请输入目标名称', 'error');
      return;
    }
    const now = nowISO();
    const goal: Goal = {
      id: uid('goal'),
      title,
      kind: 'other',
      startValue: null,
      targetValue: goalTarget,
      unit: goalUnit,
      deadline: goalDeadline || null,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveGoal(goal);
    setGoalTitle('');
    setGoalTarget(null);
    setGoalDeadline('');
    setGoalOpen(false);
    toast('目标已添加', 'success');
  }

  const openGoals = goals.filter((g) => !g.done);
  const doneGoals = goals.filter((g) => g.done);

  if (!ready) {
    return (
      <Page title="我的">
        <div className="skeleton" style={{ height: 200 }} />
      </Page>
    );
  }

  return (
    <Page title="我的" sub="所有数据只保存在这台设备上">
      {/* 目标 */}
      <SectionTitle action="+ 新目标" onAction={() => setGoalOpen(true)}>
        目标
      </SectionTitle>
      {goals.length === 0 ? (
        <Card>
          <EmptyState emoji="🎯" title="还没有目标" desc="例如：体重 68kg、深蹲 120kg、每周训练 5 次" />
        </Card>
      ) : (
        <div className="list">
          {[...openGoals, ...doneGoals].map((g) => (
            <ListRow
              key={g.id}
              title={`${g.done ? '✅ ' : ''}${g.title}`}
              sub={[
                g.targetValue != null ? `目标 ${formatNumber(g.targetValue)}${g.unit ?? ''}` : null,
                g.deadline ? `截止 ${formatDateShort(g.deadline)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                <div className="row" style={{ gap: 6 }}>
                  <Button
                    size="sm"
                    onClick={() => void saveGoal({ ...g, done: !g.done })}
                  >
                    {g.done ? '恢复' : '完成'}
                  </Button>
                  <button className="icon-btn" aria-label="删除目标" onClick={() => void deleteGoal(g.id)}>
                    <IconTrash width={18} height={18} />
                  </button>
                </div>
              }
            />
          ))}
        </div>
      )}

      {/* 补剂已移到「今日总结」的第 5 步，这里只做入口与概览 */}
      <SectionTitle>今日补剂</SectionTitle>
      <Card>
        <div className="row-between">
          <div style={{ minWidth: 0 }}>
            <div className="strong">
              {todayLog?.noSupplements
                ? '今天没吃补剂'
                : todayLog?.supplementsList?.length ||
                    todayLog?.supplements?.proteinG ||
                    todayLog?.supplements?.creatineG
                  ? [
                      todayLog?.supplements?.proteinG
                        ? `蛋白 ${todayLog.supplements.proteinG}g`
                        : '',
                      todayLog?.supplements?.creatineG
                        ? `肌酸 ${todayLog.supplements.creatineG}g`
                        : '',
                      ...(todayLog?.supplementsList ?? []).map(
                        (s) => `${s.name}${s.amount ? ` ${s.amount}${s.unit ?? ''}` : ''}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : '还没有记录'
              }
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              补剂改为在「今日总结」里填写，和当天训练、睡眠放在一起
            </div>
          </div>
        </div>
        <Button
          block
          variant="primary"
          size="lg"
          style={{ marginTop: 12 }}
          data-testid="go-supplements"
          onClick={() => navigate('/summary?tab=today')}
        >
          去今日总结记录补剂
        </Button>
      </Card>

      {/* 外观 */}
      <SectionTitle>外观</SectionTitle>
      <Card>
        <div className="small muted" style={{ marginBottom: 8 }}>
          主题
        </div>
        <Segmented<ThemeMode>
          value={settings.theme}
          onChange={(v) => void saveSettings({ theme: v })}
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </Card>

      {/* 数据概览 */}
      <SectionTitle>数据概览</SectionTitle>
      <div className="stat-grid three">
        <Card flat>
          <div className="small muted">训练计划</div>
          <div className="strong" style={{ fontSize: 24 }}>{plans.length}</div>
        </Card>
        <Card flat>
          <div className="small muted">训练记录</div>
          <div className="strong" style={{ fontSize: 24 }}>{summaries.length}</div>
        </Card>
        <Card flat>
          <div className="small muted">动作库</div>
          <div className="strong" style={{ fontSize: 24 }}>{library.length}</div>
        </Card>
      </div>
      <Card>
        <div className="row-between">
          <span className="muted small">训练模板</span>
          <span className="strong">{templates.length}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted small">个人纪录 PR</span>
          <span className="strong">{prs.length}</span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted small">累计训练容量</span>
          <span className="strong">
            {formatVolume(summaries.reduce((n, s) => n + (s.totalVolumeKg || 0), 0))}
          </span>
        </div>
        <div className="divider" />
        <div className="row-between">
          <span className="muted small">本地占用空间</span>
          <span className="strong">{storage != null ? formatBytes(storage) : '计算中…'}</span>
        </div>
      </Card>

      {/* 版本与更新 */}
      <SectionTitle>版本与更新</SectionTitle>
      <UpdatePanel />

      {/* PWA 安装 */}
      <SectionTitle>添加到手机主屏幕</SectionTitle>
      <Card>
        {standalone ? (
          <div className="row" style={{ gap: 8 }}>
            <Chip tone="green">已作为独立应用运行</Chip>
          </div>
        ) : (
          <>
            {isIOS() ? (
              <ol className="install-steps">
                <li>
                  用 <strong>Safari</strong> 打开本页面，点底部中间的「分享」按钮
                </li>
                <li>在菜单里选择「添加到主屏幕」</li>
                <li>点「添加」，之后从主屏幕图标打开即可全屏使用</li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>用 Chrome / Edge 打开本页面</li>
                <li>点右上角菜单，选择「安装应用」或「添加到主屏幕」</li>
                <li>之后从桌面图标启动，可离线使用</li>
              </ol>
            )}
            <Button block variant="primary" size="lg" onClick={() => void installApp()} style={{ marginTop: 12 }}>
              <IconShare width={18} height={18} style={{ marginRight: 6 }} />
              {installEvent ? '立即安装' : '查看安装说明'}
            </Button>
          </>
        )}
      </Card>

      {/* 备份与恢复 */}
      <SectionTitle>备份与恢复</SectionTitle>
      <Card>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="strong" style={{ fontSize: 15 }}>
            数据保存在本机
          </span>
          <Chip tone="green">不上传服务器</Chip>
        </div>
        <div className="tiny muted" style={{ marginBottom: 12 }}>
          计划 {plans.length} · 训练记录 {summaries.length} · 每日总结 {dailyLogs.length} · 身体数据{' '}
          {bodyMetrics.length} · 截图与报告 {attachments.length + chatGptReports.length}
          <br />
          卸载应用、清理浏览器数据或换手机会丢失这些内容，建议每周导出一次备份。
        </div>
        <div className="col" style={{ gap: 10 }}>
          <Button
            block
            size="lg"
            variant="primary"
            data-testid="export-backup"
            onClick={() => void exportBackup()}
          >
            导出完整备份（含截图与报告）
          </Button>
          <Button
            block
            size="lg"
            data-testid="restore-open"
            onClick={() => restoreInput.current?.click()}
          >
            从备份文件恢复
          </Button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            data-testid="restore-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onRestoreFile(file);
            }}
          />
          <div className="tiny muted">
            上次备份：
            {settings.lastBackupAt ? formatDateCN(settings.lastBackupAt.slice(0, 10)) : '还没有备份'}
            。备份文件包含计划、训练记录、身体数据与设置，请妥善保存。
          </div>
        </div>
      </Card>

      {/* 数据管理 */}
      <SectionTitle>数据管理</SectionTitle>
      <Card>
        <div className="col" style={{ gap: 10 }}>
          <Button block size="lg" onClick={() => setConfirmSamples(true)}>
            重新载入示例数据
          </Button>
          <Button
            block
            size="lg"
            data-testid="cleanup-open"
            onClick={() => setCleanupOpen(true)}
          >
            清空全部记录（保留目标）
          </Button>
          <Button block size="lg" variant="danger" onClick={() => setConfirmClear(true)}>
            清空全部本地数据
          </Button>
          <div className="tiny muted">
            数据保存在浏览器的 IndexedDB 中。清理浏览器数据或卸载应用会导致数据丢失，建议定期导出备份。
            「清空全部记录」只删除训练与每日记录（会先自动备份），不影响目标、动作库、模板、ChatGPT
            报告与更新设置；「清空全部本地数据」会连同设置一起重置。
          </div>
        </div>
      </Card>

      <CleanupSheet open={cleanupOpen} onClose={() => setCleanupOpen(false)} />

      {/* PDF 导入记录 */}
      <SectionTitle>PDF 导入记录</SectionTitle>
      {pdfImports.length === 0 ? (
        <Card>
          <EmptyState emoji="📄" title="还没有导入过 PDF" desc="导入后可以在这里查看解析结果与是否已保存" />
        </Card>
      ) : (
        <div className="list">
          {[...pdfImports]
            .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
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

      <div className="tiny muted center" style={{ margin: '24px 0 8px' }}>
        我的训练 · v{currentVersion()} · 数据本地存储，离线可用
      </div>

      {/* 恢复确认：先展示将写入什么，再决定是否导入 */}
      <Sheet
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="确认恢复备份？"
        footer={
          <div className="col" style={{ gap: 10 }}>
            <Button
              block
              size="lg"
              variant="primary"
              disabled={restoring}
              data-testid="restore-confirm"
              onClick={async () => {
                if (!pendingRestore || restoring) return;
                setRestoring(true);
                try {
                  await restoreBackup(pendingRestore.file);
                  toast('备份已恢复（同一天的记录已用备份内容覆盖）', 'success');
                  setRestoreOpen(false);
                  setPendingRestore(null);
                } catch (err) {
                  console.error('[backup] 恢复失败', err);
                  toast('恢复失败：备份内容不完整，原有数据未被修改', 'error');
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {restoring ? '正在恢复…' : '确认恢复'}
            </Button>
            <Button block size="lg" onClick={() => setRestoreOpen(false)}>
              取消
            </Button>
          </div>
        }
      >
        {pendingRestore && (
          <div>
            <div className="small muted">文件：{pendingRestore.fileName}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              导出时间：
              {pendingRestore.exportedAt
                ? formatDateCN(pendingRestore.exportedAt.slice(0, 10))
                : '未知'}
            </div>
            <div className="divider" />
            <div className="stat-grid three">
              <Stat label="训练计划" value={pendingRestore.summary.plans} />
              <Stat label="训练记录" value={pendingRestore.summary.summaries} />
              <Stat label="每日总结" value={pendingRestore.summary.dailyLogs} />
            </div>
            <div className="stat-grid three" style={{ marginTop: 10 }}>
              <Stat label="身体数据" value={pendingRestore.summary.bodyMetrics} />
              <Stat label="分析报告" value={pendingRestore.summary.chatGptReports} />
              <Stat label="截图附件" value={pendingRestore.summary.attachments} />
            </div>
            <div className="chip orange" style={{ marginTop: 12, whiteSpace: 'normal' }}>
              导入方式：按 id 合并。同一天 / 同一条的记录会用备份内容覆盖，其他本机记录保持不变；
              不会清空现有数据。若担心，请先导出当前备份。
            </div>
          </div>
        )}
      </Sheet>

      {/* 新增目标 */}
      <Sheet
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        title="新增目标"
        footer={
          <Button block variant="primary" size="lg" onClick={() => void addGoal()}>
            保存目标
          </Button>
        }
      >
        <Field label="目标内容">
          <TextInput value={goalTitle} onChange={setGoalTitle} placeholder="例如：体重降到 68kg" />
        </Field>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <div className="grow">
            <Field label="目标数值（可选）">
              <NumberInput value={goalTarget} onChange={setGoalTarget} placeholder="68" />
            </Field>
          </div>
          <div className="grow">
            <Field label="单位">
              <TextInput value={goalUnit} onChange={setGoalUnit} placeholder="kg" />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="截止日期（可选）">
            <TextInput type="date" value={goalDeadline} onChange={setGoalDeadline} />
          </Field>
        </div>
      </Sheet>

      <Confirm
        open={confirmClear}
        title="清空全部本地数据？"
        message="计划、训练记录、身体数据、导入记录都会被删除，操作无法撤销。建议先导出备份。"
        confirmText="确认清空"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          void clearAllData().then(() => toast('数据已清空', 'success'));
        }}
      />

      <Confirm
        open={confirmSamples}
        title="载入示例数据？"
        message="会新增示例训练计划、身体数据与训练记录，不会删除已有内容。"
        confirmText="载入示例"
        onCancel={() => setConfirmSamples(false)}
        onConfirm={() => {
          setConfirmSamples(false);
          void restoreSamples().then(() => toast('示例数据已载入', 'success'));
        }}
      />
    </Page>
  );
}
