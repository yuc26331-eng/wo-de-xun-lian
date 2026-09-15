/**
 * 把 tesseract.js 的运行时文件与语言模型复制到 public/ocr（按需加载 + Service Worker 缓存）。
 * 这些文件不进 git（见 .gitignore），由 prebuild / predev 自动生成。
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

/** 从入口文件向上找到包根目录（兼容 exports 未暴露 package.json 的情况） */
function pkgRoot(name) {
  let dir = dirname(require.resolve(name));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`找不到包目录：${name}`);
}
const outRoot = resolve(process.cwd(), 'public', 'ocr');
const coreDir = join(outRoot, 'core');
const langDir = join(outRoot, 'lang');
mkdirSync(coreDir, { recursive: true });
mkdirSync(langDir, { recursive: true });

function copy(from, to) {
  if (!existsSync(from)) {
    console.warn('[ocr] 缺少文件：', from);
    return false;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log('[ocr]', to.replace(process.cwd(), '.'), `${(statSync(to).size / 1024 / 1024).toFixed(2)}MB`);
  return true;
}

// 1) worker
const tesseractDir = pkgRoot('tesseract.js');
copy(join(tesseractDir, 'dist', 'worker.min.js'), join(outRoot, 'worker.min.js'));

// 2) wasm core（SIMD 与 relaxed-SIMD 两种，覆盖 iPhone Safari 与桌面 Chrome）
const corePkg = pkgRoot('tesseract.js-core');
for (const name of [
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
]) {
  copy(join(corePkg, name), join(coreDir, name));
}

// 3) 语言模型（量化版：体积小、精度接近 best）
for (const [lang, sub] of [
  ['chi_sim', '4.0.0_best_int'],
  ['eng', '4.0.0_best_int'],
]) {
  const pkgDir = pkgRoot(`@tesseract.js-data/${lang}`);
  copy(
    join(pkgDir, sub, `${lang}.traineddata.gz`),
    join(langDir, `${lang}.traineddata.gz`),
  );
}

console.log('[ocr] 资源准备完成');
