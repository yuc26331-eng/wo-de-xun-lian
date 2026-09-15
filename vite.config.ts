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
                '首页改版：首屏直接显示「今天练什么」、预计时长与开始 / 继续训练（含已完成组数）',
                '跟练优化：大号计时、一键「撤销上一组」、休息页也能撤销误操作，暂停 / 跳过更顺手',
                '恢复更可靠：切换应用、锁屏、刷新后自动回到当前动作与组数，倒计时按真实时间校准',
                '记录更可靠：新增保存状态提示与「数据保存在本机」说明；备份导出 / 导入带格式校验与覆盖提示',
                '看见进步：训练记录开始保存每个动作的实际组数据，数据页可对比同一动作的重量与次数变化',
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
        globIgnores: ['**/version.json'],
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
