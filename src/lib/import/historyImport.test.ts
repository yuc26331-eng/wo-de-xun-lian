import { describe, expect, it } from 'vitest';
import { importHistoryBundle, type HistoryImportTarget } from './historyImport';
import type { HistoryBundleMeta } from './historyBundle';
import type { AttachmentMeta, DailyLog, ISODate, WorkoutSummary } from '../../types';
import type { HistoryBundleDay } from './historyBundle';

const ITERATIONS = 1000;
const CODE = 'TESTCODE1234';

const b64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const DAYS: HistoryBundleDay[] = [
  {
    date: '2026-08-04',
    file: '8月4日训练总结.pdf',
    title: '8月4日训练总结',
    training: {
      items: '上午力量训练 + 下午足球训练',
      sessionCount: 2,
      sessionDurationsMin: [60, 102],
      sessions: [
        { name: '上午力量训练', kind: 'strength', durationMin: 60 },
        { name: '下午足球训练', kind: 'football', durationMin: 102, distanceKm: 5.05, kcal: 1223 },
      ],
    },
    watch: { steps: 14332, distanceKm: 11.86, activeEnergyKcal: 2575 },
    sleep: { totalHours: 5.02, napMinutes: 60 },
    supplements: { proteinCups: 2, creatineCups: 1 },
    meals: { lunch: '炒饭、牛肉' },
    fatigue10: 7,
    note: '建议今晚提前睡眠。',
    reportText: '原文-A',
    pdfBase64: btoa('%PDF-1.4 A'),
    pdfSize: 100,
  },
  {
    date: '2026-08-06',
    file: '2026-08-06_训练恢复总结.pdf',
    title: '2026年8月6日 训练与恢复总结',
    training: {
      items: '上午力量训练 + 下午足球训练',
      rpe: 7.4,
      sessionCount: 2,
      sessionDurationsMin: [67, 75],
      sessions: [
        { name: '上午力量训练', kind: 'strength', durationMin: 67, kcal: 457, avgHr: 104, rpe: 7.5 },
        { name: '下午足球训练', kind: 'football', durationMin: 75, rpe: 7.3 },
      ],
    },
    watch: { activeEnergyKcal: 1437, steps: 10419, distanceKm: 8.08 },
    reportText: '原文-B',
    pdfBase64: btoa('%PDF-1.4 B'),
    pdfSize: 200,
  },
];

async function makeBundle(days = DAYS) {
  const payload = {
    app: 'wo-de-xun-lian',
    kind: 'history-import',
    version: 1,
    generatedAt: '2026-09-16T00:00:00.000Z',
    days,
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(CODE),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const meta: HistoryBundleMeta = {
    app: 'wo-de-xun-lian',
    kind: 'history-import',
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    file: 'history.bin',
    days: days.length,
    dateStart: days[0].date,
    dateEnd: days[days.length - 1].date,
    generatedAt: '2026-09-16T00:00:00.000Z',
  };

  const bytes = new Uint8Array(cipher);
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('history.json')) {
      return { ok: true, status: 200, json: async () => meta } as unknown as Response;
    }
    if (!url.endsWith('import/history.bin')) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { meta, fetchImpl, requested };
}

function makeTarget(existing: DailyLog[] = []) {
  const logs = new Map<ISODate, DailyLog>(existing.map((l) => [l.date, l]));
  const attachments = new Map<string, { meta: AttachmentMeta; blob: Blob }>();
  const summaries = new Map<string, WorkoutSummary>();
  const calls: string[] = [];
  let backupCount = 0;
  let writeStarted = 0;

  const target: HistoryImportTarget = {
    getDailyLog: async (date) => {
      calls.push(`get:${date}`);
      return logs.get(date) ?? null;
    },
    createBackupSnapshot: async (reason) => {
      backupCount += 1;
      calls.push('backup');
      return { id: `snap-${backupCount}`, createdAt: '2026-09-16T00:00:00.000Z', reason, payload: '{}', summary: {} };
    },
    saveDailyLog: async (patch) => {
      if (!writeStarted) writeStarted = calls.indexOf('backup');
      calls.push(`save:${patch.date}`);
      const next = { ...(logs.get(patch.date) ?? {}), ...patch } as DailyLog;
      logs.set(patch.date, next);
      return next;
    },
    saveAttachment: async (meta, blob) => {
      calls.push(`attach:${meta.id}`);
      attachments.set(meta.id, { meta, blob });
    },
    saveSummary: async (summary) => {
      calls.push(`summary:${summary.id}`);
      summaries.set(summary.id, summary);
    },
  };

  return { target, logs, attachments, summaries, calls, backupCount: () => backupCount, writeStarted: () => writeStarted };
}

describe('历史报告导入流程', () => {
  it('先备份再写入，两天都成为正式记录（含附件与训练记录）', async () => {
    const { fetchImpl, requested } = await makeBundle();
    const t = makeTarget();
    const progress: string[] = [];
    const result = await importHistoryBundle(CODE, t.target, {
      fetchImpl,
      now: '2026-09-16T09:00:00.000Z',
      onProgress: (p) => progress.push(p.stage),
    });

    expect(t.calls[0]).toBe('backup');
    expect(t.writeStarted()).toBe(0);
    expect(result.created).toBe(2);
    expect(result.merged).toBe(0);
    expect(result.dateStart).toBe('2026-08-04');
    expect(result.dateEnd).toBe('2026-08-06');
    expect(result.attachmentCount).toBe(2);
    expect(result.summaryCount).toBe(4);
    expect(t.attachments.get('hist-2026-08-04')?.meta.name).toBe('8月4日训练总结.pdf');
    expect(t.attachments.get('hist-2026-08-04')?.blob.type).toBe('application/pdf');
    expect(t.attachments.get('hist-2026-08-04')?.blob.size).toBeGreaterThan(0);
    expect(t.logs.get('2026-08-04')?.status).toBe('final');
    expect(t.logs.get('2026-08-04')?.reportImports?.[0].reportText).toBe('原文-A');
    expect(progress).toContain('backup');
    expect(progress.at(-1)).toBe('done');
    // 密文必须从导入包同目录取，而不是站点根目录（否则 404）
    expect(requested.some((u) => u.endsWith('import/history.json'))).toBe(true);
    expect(requested.some((u) => u.endsWith('import/history.bin'))).toBe(true);
  });

  it('重复导入同一天：不重复写入、不产生第二条记录', async () => {
    const { fetchImpl } = await makeBundle();
    const t = makeTarget();
    await importHistoryBundle(CODE, t.target, { fetchImpl, now: '2026-09-16T09:00:00.000Z' });
    const again = await importHistoryBundle(CODE, t.target, {
      fetchImpl,
      now: '2026-09-16T10:00:00.000Z',
    });
    expect(again.unchanged).toBe(2);
    expect(again.created).toBe(0);
    expect(t.logs.size).toBe(2);
    expect(t.summaries.size).toBe(4);
    expect(t.attachments.size).toBe(2);
  });

  it('已有手填数据时保留原值并列出冲突，其余照常导入', async () => {
    const { fetchImpl } = await makeBundle();
    const existing: DailyLog = {
      id: '2026-08-04',
      date: '2026-08-04',
      createdAt: '2026-08-04T20:00:00.000Z',
      updatedAt: '2026-08-04T20:00:00.000Z',
      status: 'final',
      sleep: { totalHours: 6.5 },
      body: { weightKg: 71.2 },
    };
    const t = makeTarget([existing]);
    const result = await importHistoryBundle(CODE, t.target, {
      fetchImpl,
      now: '2026-09-16T09:00:00.000Z',
    });

    expect(result.created).toBe(1);
    expect(result.merged).toBe(1);
    const merged = t.logs.get('2026-08-04')!;
    expect(merged.sleep?.totalHours).toBe(6.5); // 保留用户原值
    expect(merged.body?.weightKg).toBe(71.2);
    expect(merged.watch?.steps).toBe(14332); // 空字段继续补
    expect(merged.createdAt).toBe('2026-08-04T20:00:00.000Z');
    expect(result.conflicts.some((c) => c.date === '2026-08-04' && c.label.includes('总睡眠'))).toBe(
      true,
    );
  });

  it('导入码错误时报错，但一条数据都不会写入', async () => {
    const { fetchImpl } = await makeBundle();
    const t = makeTarget();
    await expect(
      importHistoryBundle('WRONGCODE9999', t.target, {
        fetchImpl,
        now: '2026-09-16T09:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'bad-code' });
    expect(t.logs.size).toBe(0);
    expect(t.attachments.size).toBe(0);
    expect(t.backupCount()).toBe(0);
  });

  it('网络失败时给出可读错误，原有数据不受影响', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const t = makeTarget();
    await expect(
      importHistoryBundle(CODE, t.target, { fetchImpl: failing, now: '2026-09-16T09:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(t.logs.size).toBe(0);
  });
});

describe('导入包里的未来计划不会被写成已完成训练', () => {
  it('只有建议文字、没有场次时不会生成训练记录', async () => {
    const { fetchImpl } = await makeBundle([
      {
        date: '2026-08-23',
        file: '2026-08-23_休息日训练总结.pdf',
        title: '8月23日 · 休息日训练总结',
        training: { items: '休息日：核心力量 + 河边散步' },
        note: '明天建议训练：轻量有球 30 分钟。',
        reportText: '原文-C',
      },
    ]);
    const t = makeTarget();
    const result = await importHistoryBundle(CODE, t.target, {
      fetchImpl,
      now: '2026-09-16T09:00:00.000Z',
    });
    expect(result.created).toBe(1);
    expect(result.summaryCount).toBe(0);
    expect(t.summaries.size).toBe(0);
    expect(t.logs.get('2026-08-23')?.freeNote).toContain('轻量有球');
  });
});
