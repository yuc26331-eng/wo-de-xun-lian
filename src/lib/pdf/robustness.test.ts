import { afterEach, describe, expect, it } from 'vitest';
import { installPdfJsCompatibility, installPromiseWithResolvers } from './compat';
import { DRAFT_KEY, readDraftFromSession } from './draft';

type WithResolversCtor = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};
const promiseCtor = Promise as WithResolversCtor;
const originalWithResolvers = promiseCtor.withResolvers;

afterEach(() => {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: originalWithResolvers,
  });
  sessionStorage.clear();
});

describe('旧版 Safari PDF.js 兼容层', () => {
  it('缺 Promise.withResolvers 时可以安装并正常 resolve / reject', async () => {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    installPromiseWithResolvers();
    const capability = promiseCtor.withResolvers!<number>();
    capability.resolve(42);
    await expect(capability.promise).resolves.toBe(42);
  });

  it('兼容入口可重复调用', () => {
    expect(() => {
      installPdfJsCompatibility();
      installPdfJsCompatibility();
    }).not.toThrow();
  });
});

describe('导入草稿结构校验', () => {
  it('字段缺失或类型不符时拒绝旧草稿，避免 undefined 方法调用', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        kind: 'plan',
        importId: 'broken',
        fileName: 'broken.pdf',
        title: '损坏草稿',
        exercise: [],
      }),
    );
    expect(readDraftFromSession()).toBeNull();
  });
});
