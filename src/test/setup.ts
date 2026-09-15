import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { configure } from '@testing-library/react';

// CI（GitHub Actions）上 IndexedDB 初始化 + 示例数据播种较慢，
// 默认 1s 的 findBy 等待会偶发超时；放宽到 6s，避免假失败。
configure({ asyncUtilTimeout: 6000 });

if (!globalThis.crypto || !('randomUUID' in globalThis.crypto)) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `${Math.random()}`.slice(2).padEnd(32, '0') },
    configurable: true,
  });
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
