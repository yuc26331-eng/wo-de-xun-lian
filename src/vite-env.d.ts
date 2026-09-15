/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时注入的应用版本与构建号（见 vite.config.ts） */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __APP_BUILD_TIME__: string;
