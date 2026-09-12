import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Playwright config sets testDir to ./e2e; tests run with cwd at the project
// root, so this is stable regardless of module system (avoids `import.meta`,
// which needs an ESM package.json that would also affect Next.js's own
// module resolution).
const fixturesDir = join(process.cwd(), 'e2e', 'fixtures');

/**
 * Phase 2 gate (plan Section 18, P2): a victim uploads a policy document and
 * it round-trips through evidence-service and claims-service. Cross-user
 * isolation is covered by the service-level integration tests
 * (documents.integration.test.ts, policies.integration.test.ts) — this test
 * proves the browser's multipart upload and same-origin proxy actually work,
 * which those tests, calling `app.handle()` directly, cannot.
 */
test('victim uploads a policy document and saves the policy', async ({ page }) => {
  const email = `e2e-policy-${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Playwright Policy Victim');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/kyc$/);

  await page.goto('/policy');
  await page.setInputFiles('input[type="file"]', join(fixturesDir, 'sample-policy.pdf'));
  await expect(page.getByText(/Uploaded sample-policy\.pdf/)).toBeVisible();

  await page.getByLabel('Insurer name').fill('Sandbox Insurance Co');
  await page.getByLabel(/Policy number/).fill('POL-****4321');
  await page.getByRole('button', { name: 'Save policy' }).click();

  await expect(page.getByText('Policy saved. You can add another below.')).toBeVisible();
});
