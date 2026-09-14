import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * E2E 配置：默认跑生产构建（vite preview），这样才能验证 Service Worker / 离线缓存。
 * 先执行 `pnpm build`，再执行 `pnpm e2e`。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    {
      name: 'iphone-15-chromium',
      use: { ...devices['iPhone 15'], browserName: 'chromium' },
    },
    {
      name: 'iphone-se-chromium',
      use: { ...devices['iPhone SE'], browserName: 'chromium' },
      testMatch: /(smoke|layout)\.spec\.ts/,
    },
    {
      name: 'iphone-15-pro-max-chromium',
      use: { ...devices['iPhone 15 Pro Max'], browserName: 'chromium' },
      testMatch: /(smoke|layout)\.spec\.ts/,
    },
    {
      name: 'iphone-15-webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
      testMatch: /(smoke|layout)\.spec\.ts/,
    },
  ],
});
