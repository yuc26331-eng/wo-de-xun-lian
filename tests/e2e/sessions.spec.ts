import { expect, test, type Page } from '@playwright/test';

/**
 * 一天多次训练 + 每次训练独立截图（不串场、不重复累计）
 * 用本机 IndexedDB 校验真实保存结果，全部走真实的自动保存流程。
 */

async function readLog(page: Page, date: string) {
  return page.evaluate(async (d) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('wo-de-xun-lian');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const read = (store: string) =>
      new Promise<unknown[]>((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    const logs = (await read('dailyLogs')) as { date: string; [k: string]: unknown }[];
    const atts = (await read('attachments')) as {
      id: string;
      date: string;
      sessionId?: string | null;
      kind: string;
      name: string;
      size: number;
      blob?: Blob;
    }[];
    return {
      log: logs.find((l) => l.date === d) ?? null,
      attachments: atts.filter((a) => a.date === d),
    };
  }, date);
}

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
};

test.describe('一天多次训练', () => {
  test('09:00 与 19:00 两次训练分别保存，训练次数按卡片统计', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();

    await page.getByTestId('session-add').click();
    await page.getByTestId('session-name-0').fill('上午力量训练');
    await page.getByTestId('session-start-0').fill('09:00');
    await page.getByTestId('session-duration-0').fill('60');

    await page.getByTestId('session-add').click();
    await page.getByTestId('session-name-1').fill('晚上足球比赛');
    await page.getByTestId('session-start-1').fill('19:00');
    await page.getByText('未记录').last().click();
    await page.getByTestId('session-desc-1').fill('今晚踢了 60 分钟比赛，对抗比较多');
    await page.getByTestId('session-feel-1').fill('下半场腿沉');

    await expect(page.getByTestId('session-count')).toContainText('共 2 次训练');
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    const { log } = await readLog(page, today());
    const training = (log as { training?: { sessions?: unknown[]; sessionCount?: number } })?.training;
    expect(training?.sessions).toHaveLength(2);
    expect(training?.sessionCount).toBe(2);
    const [first, second] = training!.sessions as {
      name: string;
      startTime?: string;
      durationMin?: number;
      watchRecorded?: boolean;
      feel?: string;
      note?: string;
    }[];
    expect(first.name).toBe('上午力量训练');
    expect(first.startTime).toBe('09:00');
    expect(first.durationMin).toBe(60);
    expect(second.name).toBe('晚上足球比赛');
    expect(second.startTime).toBe('19:00');
    expect(second.watchRecorded).toBe(false);
    expect(second.feel).toContain('腿沉');
    expect(second.note).toContain('60 分钟比赛');
  });

  test('删除某一次训练只删这一张卡片，其余记录保留', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('session-add').click();
    await page.getByTestId('session-name-0').fill('保留的训练');
    await page.getByTestId('session-add').click();
    await page.getByTestId('session-name-1').fill('要删除的训练');

    await page.getByTestId('session-remove-1').click();
    await page.getByTestId('session-remove-confirm-1').click();
    await expect(page.getByTestId('session-name-0')).toHaveValue('保留的训练');
    await expect(page.getByTestId('session-card-1')).toHaveCount(0);
    await expect(page.getByTestId('wizard-save-status')).toContainText('已保存', {
      timeout: 15_000,
    });

    const { log } = await readLog(page, today());
    const sessions = (log as { training?: { sessions?: { name: string }[] } })?.training?.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions?.[0].name).toBe('保留的训练');
  });

  test('旧版「训练次数 + 逗号时长」记录原样保留，不自动拆分也不丢', async ({ page }) => {
    // 直接写入一条旧格式记录（没有 sessions 字段）
    await page.goto('/#/summary');
    await page.waitForSelector("[data-testid='summary-start']");
    const date = today();
    await page.evaluate(async (d) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('wo-de-xun-lian');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('dailyLogs', 'readwrite');
        tx.objectStore('dailyLogs').put({
          id: d,
          date: d,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          training: {
            items: '上午力量 + 晚上足球',
            sessionCount: 2,
            sessionDurationsMin: [60, 90],
          },
        });
        tx.oncomplete = () => res(null);
        tx.onerror = () => rej(tx.error);
      });
    }, date);
    await page.reload();

    await page.waitForSelector("[data-testid='summary-start']");
    await page.getByTestId('summary-start').click();
    await expect(page.getByText(/旧版记录/)).toBeVisible();
    await expect(page.getByTestId('session-add')).toBeVisible();

    // 旧内容仍在库里（没有被自动改写/丢弃）
    const { log } = await readLog(page, date);
    const training = (log as { training?: Record<string, unknown> })?.training;
    expect(training?.sessionCount).toBe(2);
    expect(training?.sessionDurationsMin).toEqual([60, 90]);
    expect(training?.sessions).toBeUndefined();
  });

  test('识别不到数据的截图不会显示「已识别」', async ({ page }) => {
    await page.goto('/#/summary');
    await page.getByTestId('summary-start').click();
    await page.getByTestId('wizard-next').click();
    await page.waitForSelector("[data-testid='ocr-input-watch']", { state: 'attached' });

    // 一张纯色图片（没有文字）
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 600;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 400, 600);
      return canvas.toDataURL('image/png');
    });
    const buffer = Buffer.from(png.split(',')[1], 'base64');
    await page.getByTestId('ocr-input-watch').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer,
    });

    await expect(page.locator("[data-testid='screenshot-step-watch'] .ocr-badge")).toContainText(
      '未识别到有效数据',
      { timeout: 180_000 },
    );
    await expect(page.getByText(/没有提取到可用数值/)).toBeVisible();
  });
});
