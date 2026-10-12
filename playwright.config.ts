import { defineConfig } from '@playwright/test';
import { config } from './src/config';

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  timeout: config.timeoutMs + 5000,
  retries: 0,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['./src/summary-reporter.ts'],
  ],
  use: {
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
