import { defineConfig, devices } from '@playwright/test';

/**
 * The Phase 1 gate (plan Section 18): signup, complete mock KYC, refresh a
 * session, log out, confirm protected-route behavior — run against an
 * already-running stack (`./scripts/dev.sh`), the same way `smoke.sh` does,
 * rather than managing the whole backend from Playwright's `webServer`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
