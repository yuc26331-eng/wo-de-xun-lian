import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

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
