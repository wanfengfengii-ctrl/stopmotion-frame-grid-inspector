import { defineConfig, devices } from '@playwright/test';

// 静态预览服务器：直接服务 vite build 产物，默认 4173 端口，
// 可用 PORT 环境变量覆盖（verify 容器与本地均可）。
const port = Number(process.env.PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    // 仅在受限容器（无用户命名空间 / 沙箱）中通过 PLAYWRIGHT_NO_SANDBOX=1 放宽；
    // 默认与 verify 镜像保持一致，不附加这些参数。
    launchOptions: process.env.PLAYWRIGHT_NO_SANDBOX
      ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: `npx vite preview --host 127.0.0.1 --port ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
