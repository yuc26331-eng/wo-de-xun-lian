import { describe, expect, it } from 'vitest';
import {
  HistoryImportError,
  decryptHistoryBundle,
  formatImportCode,
  isImportCodeShape,
  normalizeImportCode,
  type HistoryBundleMeta,
} from './historyBundle';

/** 测试用低迭代数（生产用 250k），其余算法与生产完全一致 */
const ITERATIONS = 1000;

const b64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

async function makeBundle(
  payload: unknown,
  code: string,
  overrides: Partial<HistoryBundleMeta> = {},
): Promise<{ meta: HistoryBundleMeta; bytes: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
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
    days: 1,
    dateStart: '2026-08-04',
    dateEnd: '2026-08-04',
    generatedAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
  return { meta, bytes: new Uint8Array(cipher) };
}

const BUNDLE = {
  app: 'wo-de-xun-lian',
  kind: 'history-import',
  version: 1,
  generatedAt: '2026-09-16T00:00:00.000Z',
  days: [{ date: '2026-08-04', file: 'a.pdf', title: '8月4日训练总结' }],
};

describe('导入码处理', () => {
  it('忽略大小写、空格与连字符', () => {
    expect(normalizeImportCode(' test-code 1234 ')).toBe('TESTCODE1234');
    expect(formatImportCode('testcode1234')).toBe('TEST-CODE-1234');
    expect(isImportCodeShape('TEST-CODE-1234')).toBe(true);
    expect(isImportCodeShape('abc')).toBe(false);
  });
});

describe('解密导入包', () => {
  it('正确导入码可以解密并按结构返回', async () => {
    const { meta, bytes } = await makeBundle(BUNDLE, 'TESTCODE1234');
    const bundle = await decryptHistoryBundle(meta, bytes, 'test-code-1234');
    expect(bundle.days).toHaveLength(1);
    expect(bundle.days[0].date).toBe('2026-08-04');
  });

  it('导入码错误时给出明确错误（不是崩溃、也不是空数据）', async () => {
    const { meta, bytes } = await makeBundle(BUNDLE, 'TESTCODE1234');
    await expect(decryptHistoryBundle(meta, bytes, 'WRONG-CODE-9999')).rejects.toMatchObject({
      name: 'HistoryImportError',
      code: 'bad-code',
    });
  });

  it('用户输入带连字符/小写/空格都能解开（网站端统一规范化）', async () => {
    // 现在打包端也会规范化导入码，因此规范化后的密钥是唯一口径
    const normalizedBundle = await makeBundle(BUNDLE, 'TESTCODE1234');
    await expect(
      decryptHistoryBundle(normalizedBundle.meta, normalizedBundle.bytes, 'test-code 1234'),
    ).resolves.toBeTruthy();
    // 兼容早期用原始（带连字符）码打包的包：原样输入仍然可以解开
    const legacyBundle = await makeBundle(BUNDLE, 'TEST-CODE-1234');
    await expect(
      decryptHistoryBundle(legacyBundle.meta, legacyBundle.bytes, 'TEST-CODE-1234'),
    ).resolves.toBeTruthy();
  });

  it('密文被篡改时不会静默通过', async () => {
    const { meta, bytes } = await makeBundle(BUNDLE, 'TESTCODE1234');
    const tampered = new Uint8Array(bytes);
    tampered[10] ^= 0xff;
    await expect(decryptHistoryBundle(meta, tampered, 'TESTCODE1234')).rejects.toBeInstanceOf(
      HistoryImportError,
    );
  });

  it('日期不合法的包整体拒绝，避免写错日期', async () => {
    const bad = { ...BUNDLE, days: [{ date: '8月4日', file: 'a.pdf', title: 'x' }] };
    const { meta, bytes } = await makeBundle(bad, 'TESTCODE1234');
    await expect(decryptHistoryBundle(meta, bytes, 'TESTCODE1234')).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('不是本应用的包会被识别出来', async () => {
    const other = { app: 'travel', kind: 'history-import', version: 1, days: [] };
    const { meta, bytes } = await makeBundle(other, 'TESTCODE1234');
    await expect(decryptHistoryBundle(meta, bytes, 'TESTCODE1234')).rejects.toMatchObject({
      code: 'corrupt',
    });
  });
});
