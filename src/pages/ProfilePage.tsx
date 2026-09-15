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
  Stepper,
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
import { UpdatePanel } from '../components/UpdatePanel';
import { PDF_KIND_LABEL, type BackupFile, type Goal, type ThemeMode } from '../types';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<unknown> };

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
  const {
    ready,
    settings,
    saveSettings,
    goals,
    saveGoal,
    deleteGoal,
    dailyLogs,
    saveDailyLog,
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
  } = useAppData();

  const today = toISODate();
  const todayLog = useMemo(() => dailyLogs.find((d) => d.date === today) ?? null, [dailyLogs, today]);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState<number | null>(null);
  const [goalUnit, setGoalUnit] = useState('kg');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [protein, setProtein] = useState<number>(todayLog?.supplements?.proteinG ?? 0);
  const [scoops, setScoops] = useState<number>(todayLog?.supplements?.proteinScoops ?? 0);
  const [creatine, setCreatine] = useState<number>(todayLog?.supplements?.creatineG ?? 0);
  const [storage, setStorage] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSamples, setConfirmSamples] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
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

  useEffect(() => {
    setProtein(todayLog?.supplements?.proteinG ?? 0);
    setScoops(todayLog?.supplements?.proteinScoops ?? 0);
    setCreatine(todayLog?.supplements?.creatineG ?? 0);
  }, [todayLog]);

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
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupFile;
      await restoreBackup(parsed);
      toast('备份已恢复', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '备份文件无法读取', 'error');
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

  async function saveSupplements() {
    await saveDailyLog({
      date: today,
      supplements: { proteinG: protein, proteinScoops: scoops, creatineG: creatine },
    });
    toast('补剂记录已保存', 'success');
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

      {/* 补剂 */}
      <SectionTitle>今日补剂</SectionTitle>
      <Card>
        <div className="col" style={{ gap: 12 }}>
          <div className="row-between">
            <span className="strong">蛋白粉</span>
            <div className="row" style={{ gap: 10 }}>
              <Stepper value={scoops} min={0} max={10} onChange={setScoops} suffix="勺" />
            </div>
          </div>
          <div className="row-between">
            <span className="strong">蛋白质</span>
            <div className="row" style={{ gap: 10 }}>
              <Stepper value={protein} min={0} max={400} step={5} onChange={setProtein} suffix="g" />
            </div>
          </div>
          <div className="row-between">
            <span className="strong">肌酸</span>
            <div className="row" style={{ gap: 10 }}>
              <Stepper value={creatine} min={0} max={30} step={1} onChange={setCreatine} suffix="g" />
            </div>
          </div>
          <Button block variant="primary" size="lg" onClick={() => void saveSupplements()}>
            保存今日补剂
          </Button>
          <div className="tiny muted">
            {formatDateCN(today)} · 常温水送服，肌酸每天 3-5g 即可，注意多喝水。
          </div>
        </div>
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
        <div className="col" style={{ gap: 10 }}>
          <Button block size="lg" variant="primary" onClick={() => void exportBackup()}>
            导出 JSON 备份
          </Button>
          <Button block size="lg" onClick={() => restoreInput.current?.click()}>
            从备份文件恢复
          </Button>
          <input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
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
          <Button block size="lg" variant="danger" onClick={() => setConfirmClear(true)}>
            清空全部本地数据
          </Button>
          <div className="tiny muted">
            数据保存在浏览器的 IndexedDB 中。清理浏览器数据或卸载应用会导致数据丢失，建议定期导出备份。
          </div>
        </div>
      </Card>

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
        我的训练 · v1.0.0 · 数据本地存储，离线可用
      </div>

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
