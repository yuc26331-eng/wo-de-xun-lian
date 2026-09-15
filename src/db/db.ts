import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AppSettings,
  BodyMetric,
  ChatGptReport,
  DailyLog,
  ExerciseDef,
  Goal,
  LiveSession,
  PdfImportRecord,
  PersonalRecord,
  PlanTemplate,
  StoredAttachment,
  TrainingPlan,
  WorkoutSummary,
} from '../types';

export const DB_NAME = 'wo-de-xun-lian';
/** v2：新增「附件（截图）」「ChatGPT 分析报告」两个 store；旧数据自动保留 */
export const DB_VERSION = 2;

export interface StoreMap {
  plans: TrainingPlan;
  sessions: LiveSession;
  summaries: WorkoutSummary;
  bodyMetrics: BodyMetric;
  dailyLogs: DailyLog;
  exercises: ExerciseDef;
  templates: PlanTemplate;
  prs: PersonalRecord;
  goals: Goal;
  settings: AppSettings;
  pdfImports: PdfImportRecord;
  attachments: StoredAttachment;
  chatGptReports: ChatGptReport;
}

export type StoreName = keyof StoreMap;

export const ALL_STORES: StoreName[] = [
  'plans',
  'sessions',
  'summaries',
  'bodyMetrics',
  'dailyLogs',
  'exercises',
  'templates',
  'prs',
  'goals',
  'settings',
  'pdfImports',
  'attachments',
  'chatGptReports',
];

interface FitnessDB extends DBSchema {
  plans: { key: string; value: TrainingPlan; indexes: { date: string } };
  sessions: { key: string; value: LiveSession };
  summaries: { key: string; value: WorkoutSummary; indexes: { date: string } };
  bodyMetrics: { key: string; value: BodyMetric; indexes: { date: string } };
  dailyLogs: { key: string; value: DailyLog; indexes: { date: string } };
  exercises: { key: string; value: ExerciseDef };
  templates: { key: string; value: PlanTemplate };
  prs: { key: string; value: PersonalRecord; indexes: { exerciseName: string } };
  goals: { key: string; value: Goal };
  settings: { key: string; value: AppSettings };
  pdfImports: { key: string; value: PdfImportRecord; indexes: { importedAt: string } };
  attachments: { key: string; value: StoredAttachment; indexes: { date: string } };
  chatGptReports: { key: string; value: ChatGptReport; indexes: { startDate: string } };
}

let dbPromise: Promise<IDBPDatabase<FitnessDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<FitnessDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FitnessDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('plans')) {
          db.createObjectStore('plans', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('summaries')) {
          db.createObjectStore('summaries', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('bodyMetrics')) {
          db.createObjectStore('bodyMetrics', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('dailyLogs')) {
          db.createObjectStore('dailyLogs', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('exercises')) {
          db.createObjectStore('exercises', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('prs')) {
          db.createObjectStore('prs', { keyPath: 'id' }).createIndex('exerciseName', 'exerciseName');
        }
        if (!db.objectStoreNames.contains('goals')) {
          db.createObjectStore('goals', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pdfImports')) {
          db.createObjectStore('pdfImports', { keyPath: 'id' }).createIndex('importedAt', 'importedAt');
        }
        // v2 新增：截图附件（Apple Watch / 睡眠）与 ChatGPT 分析报告
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' }).createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('chatGptReports')) {
          db.createObjectStore('chatGptReports', { keyPath: 'id' }).createIndex(
            'startDate',
            'startDate',
          );
        }
      },
      blocked() {
        console.warn('[db] 其他标签页占用数据库，请关闭旧页面');
      },
    });
  }
  return dbPromise;
}

export async function dbGetAll<K extends StoreName>(store: K): Promise<StoreMap[K][]> {
  const db = await getDB();
  return (await db.getAll(store)) as StoreMap[K][];
}

export async function dbGet<K extends StoreName>(
  store: K,
  key: string,
): Promise<StoreMap[K] | undefined> {
  const db = await getDB();
  return (await db.get(store, key)) as StoreMap[K] | undefined;
}

export async function dbPut<K extends StoreName>(store: K, value: StoreMap[K]): Promise<void> {
  const db = await getDB();
  await db.put(store, value as never);
}

export async function dbPutMany<K extends StoreName>(
  store: K,
  values: StoreMap[K][],
): Promise<void> {
  if (!values.length) return;
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  for (const v of values) void tx.store.put(v as never);
  await tx.done;
}

export async function dbDelete<K extends StoreName>(store: K, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, key);
}

export async function dbClear<K extends StoreName>(store: K): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}

export async function dbClearAll(): Promise<void> {
  const db = await getDB();
  const stores = [...ALL_STORES];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

/** 估算占用空间（字节），用于「数据管理」显示 */
export async function estimateStorageSize(): Promise<number> {
  let total = 0;
  for (const store of ALL_STORES) {
    const rows = await dbGetAll(store);
    total += JSON.stringify(rows).length * 2;
  }
  return total;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
