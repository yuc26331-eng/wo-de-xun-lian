/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时注入的应用版本与构建号（见 vite.config.ts） */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __APP_BUILD_TIME__: string;

/** PDF.js legacy worker 通过 Vite worker 包装加载，不需要类型文件。 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
