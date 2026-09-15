import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/** 部署到子路径（如 GitHub Pages）时用 VITE_BASE 覆盖 */
const base = process.env.VITE_BASE ?? '/';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
/** 运行中的应用版本与构建号（更新检查、缓存一致性都以它为准） */
const APP_VERSION = process.env.APP_VERSION ?? pkg.version;
const BUILD_ID = (process.env.GITHUB_SHA ?? process.env.BUILD_ID ?? String(Date.now())).slice(0, 12);
const BUILD_TIME = new Date().toISOString();
const RELEASE_NOTES = (process.env.RELEASE_NOTES ?? '')
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean);

/** 生成 version.json（供“检查更新”对比）并把构建号写进 index.html 便于完整性校验 */
function versionPlugin() {
  return {
    name: 'app-version-plugin',
    transformIndexHtml(html: string) {
      return html.replace(
        '</head>',
        `  <meta name="app-version" content="${APP_VERSION}" />\n` +
          `  <meta name="app-build" content="${BUILD_ID}" />\n</head>`,
      );
    },
    generateBundle(this: { emitFile: (f: unknown) => void }) {
      const payload = {
        app: 'wo-de-xun-lian',
        name: '我的训练',
        version: APP_VERSION,
        build: BUILD_ID,
        buildTime: BUILD_TIME,
        notes:
          RELEASE_NOTES.length > 0
            ? RELEASE_NOTES
            : [
                '新增「导入历史报告」：把之前的今日总结 PDF 按报告日期导入成正式记录（训练 / Apple Watch / 睡眠 / 补剂 / 饮食 / 报告原文 + 原始 PDF 附件）',
                '导入前自动备份；同一天只补空字段、不覆盖已有数据，冲突会逐条列出等你确认',
                '报告原文、评分、每场训练明细可在该日详情里查看，原始 PDF 可打开或下载',
                '训练记录写入统计：本周次数、累计时长、RPE 趋势与跑步距离都会把历史报告算进去',
                '今日总结新增体检项：手表移动距离、疲劳（0~10）与补剂备注都可以直接编辑',
              ],
      };
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(payload, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_BUILD__: JSON.stringify(BUILD_ID),
    __APP_BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    versionPlugin(),
    VitePWA({
      // 用自定义 Service Worker（injectManifest）：支持“立即更新/回退上一版本/离线可用”
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg', 'fonts/*.ttf'],
      manifest: {
        id: base,
        name: '我的训练',
        short_name: '我的训练',
        description: '中文训练记录与实时跟练，数据保存在本地设备，离线可用。',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        categories: ['health', 'fitness', 'sports'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ttf,woff2,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        // OCR 运行时与语言模型改为首次识别时按需下载（见 sw.ts 的运行时缓存），
        // 避免把 15MB 模型塞进首装预缓存
        globIgnores: ['**/version.json', '**/ocr/**'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 20000,
  },
});
