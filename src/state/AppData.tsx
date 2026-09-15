import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ALL_STORES,
  dbClearAll,
  dbDelete,
  dbGet,
  dbGetAll,
  dbPut,
  dbPutMany,
  getDB,
  requestPersistentStorage,
} from '../db/db';
import {
  createSamplePlans,
  createSeedDailyLog,
  createSeedExercises,
  createSeedGoals,
  createSeedMetrics,
  createSeedSummaries,
} from '../data/seed';
import { nowISO, toISODate, uid } from '../lib/format';
import type {
  AppSettings,
  AttachmentMeta,
  BackupFile,
  BodyMetric,
  ChatGptReport,
  DailyLog,
  ExerciseDef,
  Goal,
  ISODate,
  LiveSession,
  PdfImportRecord,
  PersonalRecord,
  PlanDraft,
  PlanTemplate,
  StoredAttachment,
  TrainingPlan,
  WorkoutSummary,
} from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  theme: 'system',
  unit: 'kg',
  defaultRestSec: 90,
  bodyWeightGoalKg: 70,
  weeklyFrequencyGoal: 5,
  installPromptDismissed: false,
  installPromptSeenAt: null,
  remindEnabled: false,
  remindTime: '20:00',
  lastBackupAt: null,
  updatedAt: nowISO(),
};

export interface AppDataValue {
  ready: boolean;
  seedError: string | null;
  plans: TrainingPlan[];
  summaries: WorkoutSummary[];
  bodyMetrics: BodyMetric[];
  dailyLogs: DailyLog[];
  exercises: ExerciseDef[];
  templates: PlanTemplate[];
  prs: PersonalRecord[];
  goals: Goal[];
  pdfImports: PdfImportRecord[];
  settings: AppSettings;
  liveSession: LiveSession | null;
  /** 截图附件（内存中只保留元数据，二进制按需从 IndexedDB 读取） */
  attachments: AttachmentMeta[];
  chatGptReports: ChatGptReport[];

  savePlan: (plan: TrainingPlan) => Promise<TrainingPlan>;
  createPlanFromDraft: (draft: PlanDraft) => Promise<TrainingPlan>;
  deletePlan: (id: string) => Promise<void>;
  duplicatePlan: (id: string, date?: ISODate) => Promise<TrainingPlan | null>;
  savePlanAsTemplate: (planId: string, name: string) => Promise<PlanTemplate | null>;
  togglePlanArchive: (id: string) => Promise<void>;
  renamePlan: (id: string, title: string) => Promise<void>;

  saveSummary: (summary: WorkoutSummary) => Promise<void>;
  deleteSummary: (id: string) => Promise<void>;
  duplicateSummary: (id: string, date: ISODate) => Promise<WorkoutSummary | null>;
  renameSummary: (id: string, title: string) => Promise<void>;

  saveBodyMetric: (patch: Partial<BodyMetric> & { date: ISODate }) => Promise<BodyMetric>;
  deleteBodyMetric: (id: string) => Promise<void>;
  saveDailyLog: (patch: Partial<DailyLog> & { date: ISODate }) => Promise<DailyLog>;
  deleteDailyLog: (date: ISODate) => Promise<void>;
  copyDailyLog: (from: ISODate, to: ISODate) => Promise<DailyLog>;

  saveAttachment: (meta: AttachmentMeta, blob: Blob) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  loadAttachment: (id: string) => Promise<Blob | null>;

  saveChatGptReport: (report: ChatGptReport) => Promise<ChatGptReport>;
  deleteChatGptReport: (id: string) => Promise<void>;
  renameChatGptReport: (id: string, title: string) => Promise<void>;
  loadReportPdf: (id: string) => Promise<Blob | null>;

  saveExercise: (exercise: ExerciseDef) => Promise<void>;
  deleteExercise: (id: string) => Promise<void>;
  saveTemplate: (template: PlanTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  savePR: (pr: PersonalRecord) => Promise<void>;
  deletePR: (id: string) => Promise<void>;
  saveGoal: (goal: Goal) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;

  savePdfImport: (record: PdfImportRecord) => Promise<void>;
  markPdfImportSaved: (id: string, patch: Partial<PdfImportRecord>) => Promise<void>;
  deletePdfImport: (id: string) => Promise<void>;

  setLiveSession: (session: LiveSession | null) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;

  buildBackup: () => BackupFile;
  buildFullBackup: () => Promise<Blob>;
  restoreBackup: (file: BackupFile) => Promise<void>;
  clearAllData: () => Promise<void>;
  restoreSamples: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData 必须在 <AppDataProvider> 内使用');
  return ctx;
}

async function bootstrap(): Promise<{
  plans: TrainingPlan[];
  summaries: WorkoutSummary[];
  bodyMetrics: BodyMetric[];
  dailyLogs: DailyLog[];
  exercises: ExerciseDef[];
  templates: PlanTemplate[];
  prs: PersonalRecord[];
  goals: Goal[];
  pdfImports: PdfImportRecord[];
  attachments: AttachmentMeta[];
  chatGptReports: ChatGptReport[];
  settings: AppSettings;
  liveSession: LiveSession | null;
}> {
  await getDB();
  let [plans, summaries, bodyMetrics, dailyLogs, exercises, templates, prs, goals, pdfImports] =
    await Promise.all([
      dbGetAll('plans'),
      dbGetAll('summaries'),
      dbGetAll('bodyMetrics'),
      dbGetAll('dailyLogs'),
      dbGetAll('exercises'),
      dbGetAll('templates'),
      dbGetAll('prs'),
      dbGetAll('goals'),
      dbGetAll('pdfImports'),
    ]);

  // 附件只把元数据放进内存，二进制留在 IndexedDB（blob 是引用，不会整体复制）
  const storedAttachments = await dbGetAll('attachments');
  const attachments: AttachmentMeta[] = storedAttachments.map(({ blob: _blob, ...meta }) => meta);
  const chatGptReports = await dbGetAll('chatGptReports');

  const settingsRows = await dbGetAll('settings');
  const settings = settingsRows[0] ?? DEFAULT_SETTINGS;
  if (!settingsRows.length) await dbPut('settings', settings);

  // 第一次打开：写入示例数据，保证功能立刻可用
  if (!plans.length) {
    plans = createSamplePlans();
    await dbPutMany('plans', plans);
    summaries = createSeedSummaries(plans[0]);
    await dbPutMany('summaries', summaries);
    bodyMetrics = createSeedMetrics();
    await dbPutMany('bodyMetrics', bodyMetrics);
    dailyLogs = createSeedDailyLog();
    await dbPutMany('dailyLogs', dailyLogs);
    goals = createSeedGoals();
    await dbPutMany('goals', goals);
  }
  if (!exercises.length) {
    exercises = createSeedExercises();
    await dbPutMany('exercises', exercises);
  }

  const sessions = await dbGetAll('sessions');
  const liveSession =
    sessions
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;

  return {
    plans,
    summaries,
    bodyMetrics,
    dailyLogs,
    exercises,
    templates,
    prs,
    goals,
    pdfImports,
    attachments,
    chatGptReports,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    liveSession,
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [summaries, setSummaries] = useState<WorkoutSummary[]>([]);
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetric[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [exercises, setExercises] = useState<ExerciseDef[]>([]);
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [pdfImports, setPdfImports] = useState<PdfImportRecord[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [chatGptReports, setChatGptReports] = useState<ChatGptReport[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [liveSession, setLiveSessionState] = useState<LiveSession | null>(null);
  const booted = useRef(false);

  const load = useCallback(async () => {
    const data = await bootstrap();
    setPlans(data.plans);
    setSummaries(data.summaries);
    setBodyMetrics(data.bodyMetrics);
    setDailyLogs(data.dailyLogs);
    setExercises(data.exercises);
    setTemplates(data.templates);
    setPrs(data.prs);
    setGoals(data.goals);
    setPdfImports(data.pdfImports);
    setAttachments(data.attachments);
    setChatGptReports(data.chatGptReports);
    setSettings(data.settings);
    setLiveSessionState(data.liveSession);
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    load()
      .then(() => {
        setReady(true);
        void requestPersistentStorage();
      })
      .catch((err: unknown) => {
        console.error('[AppData] 初始化失败', err);
        setSeedError(err instanceof Error ? err.message : '本地数据库初始化失败');
        setReady(true);
      });
  }, [load]);

  const savePlan = useCallback(async (plan: TrainingPlan) => {
    const next = { ...plan, updatedAt: nowISO() };
    await dbPut('plans', next);
    setPlans((prev) => {
      const exists = prev.some((p) => p.id === next.id);
      return exists ? prev.map((p) => (p.id === next.id ? next : p)) : [...prev, next];
    });
    return next;
  }, []);

  const createPlanFromDraft = useCallback(
    async (draft: PlanDraft) => {
      const now = nowISO();
      const plan: TrainingPlan = {
        id: uid('plan'),
        title: draft.title.trim() || '导入的训练计划',
        date: draft.date ?? toISODate(),
        kind: draft.sessionKind,
        source: 'pdf',
        sourceFile: draft.fileName,
        estimatedMinutes: draft.estimatedMinutes,
        warmup: draft.warmup,
        exercises: draft.exercises.map((e, i) => ({ ...e, order: i })),
        cooldown: draft.cooldown,
        notes: draft.notes,
        createdAt: now,
        updatedAt: now,
      };
      return savePlan(plan);
    },
    [savePlan],
  );

  const deletePlan = useCallback(async (id: string) => {
    await dbDelete('plans', id);
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const duplicatePlan = useCallback(
    async (id: string, date?: ISODate) => {
      const src = plans.find((p) => p.id === id);
      if (!src) return null;
      const now = nowISO();
      const copy: TrainingPlan = {
        ...src,
        id: uid('plan'),
        title: `${src.title}（副本）`,
        date: date ?? src.date,
        source: 'manual',
        exercises: src.exercises.map((e) => ({ ...e, id: uid('ex') })),
        createdAt: now,
        updatedAt: now,
      };
      return savePlan(copy);
    },
    [plans, savePlan],
  );

  const savePlanAsTemplate = useCallback(
    async (planId: string, name: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return null;
      const now = nowISO();
      const tpl: PlanTemplate = {
        id: uid('tpl'),
        name: name.trim() || plan.title,
        kind: plan.kind,
        estimatedMinutes: plan.estimatedMinutes ?? null,
        warmup: plan.warmup,
        exercises: plan.exercises.map((e) => ({ ...e, id: uid('ex') })),
        note: plan.notes,
        createdAt: now,
        updatedAt: now,
      };
      await dbPut('templates', tpl);
      setTemplates((prev) => [...prev, tpl]);
      return tpl;
    },
    [plans],
  );

  const togglePlanArchive = useCallback(
    async (id: string) => {
      const plan = plans.find((p) => p.id === id);
      if (!plan) return;
      await savePlan({ ...plan, archived: !plan.archived });
    },
    [plans, savePlan],
  );

  const saveSummary = useCallback(async (summary: WorkoutSummary) => {
    await dbPut('summaries', summary);
    setSummaries((prev) => {
      const exists = prev.some((s) => s.id === summary.id);
      return exists ? prev.map((s) => (s.id === summary.id ? summary : s)) : [...prev, summary];
    });
  }, []);

  const deleteSummary = useCallback(async (id: string) => {
    await dbDelete('summaries', id);
    setSummaries((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /** 复制一条训练记录到另一个日期（同一天已存在时覆盖该条记录） */
  const duplicateSummary = useCallback(
    async (id: string, date: ISODate) => {
      const src = summaries.find((s) => s.id === id);
      if (!src) return null;
      const now = nowISO();
      const copy: WorkoutSummary = {
        ...src,
        id: uid('sum'),
        date,
        createdAt: now,
        startedAt: `${date}T${(src.startedAt || '').slice(11, 19) || '00:00:00'}`,
        endedAt: `${date}T${(src.endedAt || '').slice(11, 19) || '00:00:00'}`,
      };
      await dbPut('summaries', copy);
      setSummaries((prev) => [...prev, copy]);
      return copy;
    },
    [summaries],
  );

  const renameSummary = useCallback(
    async (id: string, title: string) => {
      const src = summaries.find((s) => s.id === id);
      if (!src) return;
      const next = { ...src, planTitle: title.trim() || src.planTitle };
      await dbPut('summaries', next);
      setSummaries((prev) => prev.map((s) => (s.id === id ? next : s)));
    },
    [summaries],
  );

  const saveBodyMetric = useCallback(async (patch: Partial<BodyMetric> & { date: ISODate }) => {
    const id = patch.date;
    const existing = await getDB().then((db) => db.get('bodyMetrics', id));
    const now = nowISO();
    const next: BodyMetric = {
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...existing,
      ...patch,
      id,
      date: patch.date,
    };
    await dbPut('bodyMetrics', next);
    setBodyMetrics((prev) => {
      const exists = prev.some((m) => m.id === id);
      const list = exists ? prev.map((m) => (m.id === id ? next : m)) : [...prev, next];
      return list.sort((a, b) => (a.date < b.date ? -1 : 1));
    });
    return next;
  }, []);

  const deleteBodyMetric = useCallback(async (id: string) => {
    await dbDelete('bodyMetrics', id);
    setBodyMetrics((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const saveDailyLog = useCallback(async (patch: Partial<DailyLog> & { date: ISODate }) => {
    const id = patch.date;
    const existing = await getDB().then((db) => db.get('dailyLogs', id));
    const now = nowISO();
    const next: DailyLog = {
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...existing,
      ...patch,
      id,
      date: patch.date,
      supplements: { ...existing?.supplements, ...patch.supplements },
    };
    await dbPut('dailyLogs', next);
    setDailyLogs((prev) => {
      const exists = prev.some((d) => d.id === id);
      return exists ? prev.map((d) => (d.id === id ? next : d)) : [...prev, next];
    });
    return next;
  }, []);

  const deleteDailyLog = useCallback(async (date: ISODate) => {
    await dbDelete('dailyLogs', date);
    setDailyLogs((prev) => prev.filter((d) => d.date !== date));
  }, []);

  /** 把某一天的记录复制到另一天（同一天已有记录时合并覆盖，不产生重复条目） */
  const copyDailyLog = useCallback(
    async (from: ISODate, to: ISODate) => {
      const src = dailyLogs.find((d) => d.date === from);
      if (!src) throw new Error('源日期没有记录');
      const existing = dailyLogs.find((d) => d.date === to);
      const now = nowISO();
      const next: DailyLog = {
        ...src,
        ...existing,
        id: to,
        date: to,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        attachmentIds: existing?.attachmentIds ?? [],
      };
      await dbPut('dailyLogs', next);
      setDailyLogs((prev) => {
        const exists = prev.some((d) => d.date === to);
        return exists ? prev.map((d) => (d.date === to ? next : d)) : [...prev, next];
      });
      return next;
    },
    [dailyLogs],
  );

  /* ------------------------- 截图附件 ------------------------- */

  const saveAttachment = useCallback(async (meta: AttachmentMeta, blob: Blob) => {
    const record: StoredAttachment = { ...meta, blob };
    await dbPut('attachments', record);
    setAttachments((prev) => {
      const exists = prev.some((a) => a.id === meta.id);
      return exists ? prev.map((a) => (a.id === meta.id ? meta : a)) : [...prev, meta];
    });
  }, []);

  const deleteAttachment = useCallback(async (id: string) => {
    await dbDelete('attachments', id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const loadAttachment = useCallback(async (id: string) => {
    const row = await dbGet('attachments', id);
    return row?.blob ?? null;
  }, []);

  /* --------------------- ChatGPT 分析报告 --------------------- */

  const saveChatGptReport = useCallback(async (report: ChatGptReport) => {
    const next = { ...report, updatedAt: nowISO() };
    await dbPut('chatGptReports', next);
    setChatGptReports((prev) => {
      const exists = prev.some((r) => r.id === next.id);
      return exists ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next];
    });
    return next;
  }, []);

  const deleteChatGptReport = useCallback(async (id: string) => {
    await dbDelete('chatGptReports', id);
    setChatGptReports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const renameChatGptReport = useCallback(
    async (id: string, title: string) => {
      const src = chatGptReports.find((r) => r.id === id);
      if (!src) return;
      await saveChatGptReport({ ...src, title: title.trim() || src.title });
    },
    [chatGptReports, saveChatGptReport],
  );

  const loadReportPdf = useCallback(async (id: string) => {
    const row = await dbGet('chatGptReports', id);
    return row?.pdfBlob ?? null;
  }, []);

  const renamePlan = useCallback(
    async (id: string, title: string) => {
      const plan = plans.find((p) => p.id === id);
      if (!plan) return;
      await savePlan({ ...plan, title: title.trim() || plan.title });
    },
    [plans, savePlan],
  );

  const saveExercise = useCallback(async (exercise: ExerciseDef) => {
    await dbPut('exercises', exercise);
    setExercises((prev) => {
      const exists = prev.some((e) => e.id === exercise.id);
      return exists ? prev.map((e) => (e.id === exercise.id ? exercise : e)) : [...prev, exercise];
    });
  }, []);

  const deleteExercise = useCallback(async (id: string) => {
    await dbDelete('exercises', id);
    setExercises((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const saveTemplate = useCallback(async (template: PlanTemplate) => {
    const next = { ...template, updatedAt: nowISO() };
    await dbPut('templates', next);
    setTemplates((prev) => {
      const exists = prev.some((t) => t.id === next.id);
      return exists ? prev.map((t) => (t.id === next.id ? next : t)) : [...prev, next];
    });
  }, []);

  const deleteTemplate = useCallback(async (id: string) => {
    await dbDelete('templates', id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const savePR = useCallback(async (pr: PersonalRecord) => {
    await dbPut('prs', pr);
    setPrs((prev) => {
      const exists = prev.some((p) => p.id === pr.id);
      return exists ? prev.map((p) => (p.id === pr.id ? pr : p)) : [...prev, pr];
    });
  }, []);

  const deletePR = useCallback(async (id: string) => {
    await dbDelete('prs', id);
    setPrs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const saveGoal = useCallback(async (goal: Goal) => {
    const next = { ...goal, updatedAt: nowISO() };
    await dbPut('goals', next);
    setGoals((prev) => {
      const exists = prev.some((g) => g.id === next.id);
      return exists ? prev.map((g) => (g.id === next.id ? next : g)) : [...prev, next];
    });
  }, []);

  const deleteGoal = useCallback(async (id: string) => {
    await dbDelete('goals', id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const savePdfImport = useCallback(async (record: PdfImportRecord) => {
    await dbPut('pdfImports', record);
    setPdfImports((prev) => {
      const exists = prev.some((r) => r.id === record.id);
      return exists ? prev.map((r) => (r.id === record.id ? record : r)) : [...prev, record];
    });
  }, []);

  const markPdfImportSaved = useCallback(
    async (id: string, patch: Partial<PdfImportRecord>) => {
      const existing = await getDB().then((db) => db.get('pdfImports', id));
      if (!existing) return;
      await savePdfImport({ ...existing, ...patch, id, saved: true });
    },
    [savePdfImport],
  );

  const deletePdfImport = useCallback(async (id: string) => {
    await dbDelete('pdfImports', id);
    setPdfImports((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const setLiveSession = useCallback(async (session: LiveSession | null) => {
    if (session) {
      await dbPut('sessions', session);
    }
    setLiveSessionState(session);
  }, []);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch, id: 'app' as const, updatedAt: nowISO() };
      void dbPut('settings', next);
      return next;
    });
  }, []);

  const buildBackup = useCallback((): BackupFile => {
    return {
      app: 'wo-de-xun-lian',
      version: 1,
      exportedAt: nowISO(),
      data: {
        plans,
        summaries,
        bodyMetrics,
        dailyLogs,
        exercises,
        templates,
        prs,
        goals,
        settings,
        liveSession,
        pdfImports,
        chatGptReports: chatGptReports.map((r) => ({ ...r, pdfBlob: undefined })),
        attachments,
      },
    };
  }, [
    attachments,
    bodyMetrics,
    chatGptReports,
    dailyLogs,
    exercises,
    goals,
    liveSession,
    pdfImports,
    plans,
    prs,
    settings,
    summaries,
    templates,
  ]);

  /** 完整备份（含截图与 ChatGPT 原始 PDF，二进制转 base64 一并导出） */
  const buildFullBackup = useCallback(async () => {
    const base = buildBackup();
    const toDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

    const storedAttachments = await dbGetAll('attachments');
    const attachmentFiles = await Promise.all(
      storedAttachments.map(async (a) => ({
        meta: { ...a, blob: undefined } as unknown as AttachmentMeta,
        dataUrl: await toDataUrl(a.blob),
      })),
    );
    const reports = await dbGetAll('chatGptReports');
    const reportPdfs = await Promise.all(
      reports
        .filter((r) => r.pdfBlob)
        .map(async (r) => ({
          id: r.id,
          fileName: r.fileName ?? 'report.pdf',
          dataUrl: await toDataUrl(r.pdfBlob as Blob),
        })),
    );
    const payload = { ...base, attachmentFiles, reportPdfs };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }, [buildBackup]);

  const restoreBackup = useCallback(
    async (file: BackupFile) => {
      if (!file || file.app !== 'wo-de-xun-lian' || !file.data) {
        throw new Error('备份文件格式不正确');
      }
      const d = file.data;
      await dbPutMany('plans', d.plans ?? []);
      await dbPutMany('summaries', d.summaries ?? []);
      await dbPutMany('bodyMetrics', d.bodyMetrics ?? []);
      await dbPutMany('dailyLogs', d.dailyLogs ?? []);
      await dbPutMany('exercises', d.exercises ?? []);
      await dbPutMany('templates', d.templates ?? []);
      await dbPutMany('prs', d.prs ?? []);
      await dbPutMany('goals', d.goals ?? []);
      await dbPutMany('pdfImports', d.pdfImports ?? []);
      await dbPutMany('chatGptReports', d.chatGptReports ?? []);
      // 附件二进制（来自完整备份）
      const extras = file as unknown as {
        attachmentFiles?: { meta: AttachmentMeta; dataUrl: string }[];
        reportPdfs?: { id: string; dataUrl: string }[];
      };
      if (extras.attachmentFiles?.length) {
        const rows: StoredAttachment[] = await Promise.all(
          extras.attachmentFiles.map(async (item) => ({
            ...item.meta,
            blob: await fetch(item.dataUrl).then((r) => r.blob()),
          })),
        );
        await dbPutMany('attachments', rows);
      } else if (d.attachments?.length) {
        // 只有元数据时保留元数据，缺附件不阻塞恢复
        setAttachments(d.attachments);
      }
      for (const pdf of extras.reportPdfs ?? []) {
        const existing = await dbGet('chatGptReports', pdf.id);
        if (existing) {
          const blob = await fetch(pdf.dataUrl).then((r) => r.blob());
          await dbPut('chatGptReports', { ...existing, pdfBlob: blob });
        }
      }
      if (d.settings) await dbPut('settings', { ...DEFAULT_SETTINGS, ...d.settings });
      if (d.liveSession) await dbPut('sessions', d.liveSession);
      await load();
      await saveSettings({ lastBackupAt: nowISO() });
    },
    [load, saveSettings],
  );

  const clearAllData = useCallback(async () => {
    await dbClearAll();
    await dbPut('settings', DEFAULT_SETTINGS);
    await load();
  }, [load]);

  const restoreSamples = useCallback(async () => {
    const samples = createSamplePlans();
    await dbPutMany('plans', samples);
    await dbPutMany('summaries', createSeedSummaries(samples[0]));
    await dbPutMany('bodyMetrics', createSeedMetrics());
    await dbPutMany('dailyLogs', createSeedDailyLog());
    await dbPutMany('goals', createSeedGoals());
    if (!(await dbGetAll('exercises')).length) {
      await dbPutMany('exercises', createSeedExercises());
    }
    await load();
  }, [load]);

  const value = useMemo<AppDataValue>(
    () => ({
      ready,
      seedError,
      plans,
      summaries,
      bodyMetrics,
      dailyLogs,
      exercises,
      templates,
      prs,
      goals,
      pdfImports,
      settings,
      liveSession,
      attachments,
      chatGptReports,
      savePlan,
      createPlanFromDraft,
      deletePlan,
      duplicatePlan,
      savePlanAsTemplate,
      togglePlanArchive,
      renamePlan,
      saveSummary,
      deleteSummary,
      duplicateSummary,
      renameSummary,
      saveBodyMetric,
      deleteBodyMetric,
      saveDailyLog,
      deleteDailyLog,
      copyDailyLog,
      saveAttachment,
      deleteAttachment,
      loadAttachment,
      saveChatGptReport,
      deleteChatGptReport,
      renameChatGptReport,
      loadReportPdf,
      saveExercise,
      deleteExercise,
      saveTemplate,
      deleteTemplate,
      savePR,
      deletePR,
      saveGoal,
      deleteGoal,
      savePdfImport,
      markPdfImportSaved,
      deletePdfImport,
      setLiveSession,
      saveSettings,
      buildBackup,
      buildFullBackup,
      restoreBackup,
      clearAllData,
      restoreSamples,
      refresh: load,
    }),
    [
      attachments,
      bodyMetrics,
      buildBackup,
      buildFullBackup,
      clearAllData,
      chatGptReports,
      copyDailyLog,
      createPlanFromDraft,
      dailyLogs,
      deleteAttachment,
      deleteBodyMetric,
      deleteChatGptReport,
      deleteDailyLog,
      deleteExercise,
      deleteGoal,
      deletePR,
      deletePdfImport,
      deletePlan,
      deleteSummary,
      deleteTemplate,
      duplicateSummary,
      duplicatePlan,
      exercises,
      goals,
      liveSession,
      loadAttachment,
      loadReportPdf,
      markPdfImportSaved,
      pdfImports,
      plans,
      prs,
      ready,
      renameChatGptReport,
      renamePlan,
      renameSummary,
      restoreBackup,
      restoreSamples,
      saveAttachment,
      saveBodyMetric,
      saveChatGptReport,
      saveDailyLog,
      saveExercise,
      saveGoal,
      savePR,
      savePlan,
      savePlanAsTemplate,
      savePdfImport,
      saveSettings,
      saveSummary,
      saveTemplate,
      seedError,
      setLiveSession,
      settings,
      summaries,
      templates,
      togglePlanArchive,
      load,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export const DB_STORE_COUNT = ALL_STORES.length;
