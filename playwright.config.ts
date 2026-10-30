import { defineConfig } from '@playwright/test';
import * as path from 'path';
import { config, workDir } from './src/config';

export default defineConfig({
  testDir: './tests',
  globalSetup: './src/global-setup.ts',
  // Generous on purpose: src/fixtures.ts may wait for the API rate-limit window. Each request still has its own timeout (REQUEST_TIMEOUT_MS).
  timeout: 330_000,
  retries: 0,
  outputDir: path.join(workDir, 'test-results'),
  workers: 1, // single worker + pacing keeps the run under the API rate limit (100 req / 3 min)
  // LIST_ONLY=true (set by the runner page when it only lists a module's tests): no report files and nothing sent to the dashboard.
  reporter: process.env.LIST_ONLY === 'true' ? [['list']] : [
    ['list'],
    ['html', { outputFolder: path.join(workDir, 'playwright-html'), open: 'never' }],
    ['./src/summary-reporter.ts'],
    ['./src/detail-reporter.ts'],
    ['./src/live-reporter.ts'],
  ],
  use: {
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
