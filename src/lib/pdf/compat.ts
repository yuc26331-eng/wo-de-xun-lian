/**
 * 为旧版 iPhone Safari / 主屏 PWA 补齐 PDF.js 需要的现代 Promise API。
 * 必须在加载 pdfjs-dist 之前执行，主线程和 PDF worker 都要安装。
 */
export function installPromiseWithResolvers(): void {
  const promiseCtor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof promiseCtor.withResolvers === 'function') return;
  promiseCtor.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export function installPdfJsCompatibility(): void {
  installPromiseWithResolvers();
  const objectCtor = Object as ObjectConstructor & {
    hasOwn?: (target: object, property: PropertyKey) => boolean;
  };
  if (typeof objectCtor.hasOwn !== 'function') {
    objectCtor.hasOwn = (target, property) =>
      Object.prototype.hasOwnProperty.call(target, property);
  }
}
