/**
 * The API rate-limits each user to 100 requests per 3 minutes (backend GENERAL_POLICY) and answers 429 beyond that.
 * Tests run on a single worker and wait PACE_MS before each test; src/fixtures.ts additionally throttles every request (REQUEST_BUDGET per 3 minutes).
 * Set PACE_MS=0 to disable (for example when running a handful of tests).
 */
const paceMs = Number(process.env.PACE_MS ?? 500);

export const pace = async (): Promise<void> => {
  if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
};
