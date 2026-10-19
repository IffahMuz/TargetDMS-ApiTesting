import { defineConfig } from '@playwright/test';
import { config } from './src/config';

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  // Generous on purpose: src/fixtures.ts may wait for the API rate-limit window. Each request still has its own timeout (REQUEST_TIMEOUT_MS).
  timeout: 330_000,
  retries: 0,
  workers: 1, // single worker + pacing keeps the run under the API rate limit (100 req / 3 min)
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
