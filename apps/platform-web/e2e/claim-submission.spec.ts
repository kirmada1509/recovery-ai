import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const fixturesDir = join(process.cwd(), 'e2e', 'fixtures');

/**
 * Phase 3 gate (plan Section 18, P3): a claim is created and submitted end
 * to end through the wizard, and its event timeline is correct. The
 * idempotent-duplicate-submit half of the gate is covered by
 * claims.integration.test.ts, which can assert on the outbox/event rows
 * directly — this test proves the actual UI flow a victim uses reaches the
 * same result.
 */
test('victim files and submits a claim through the wizard', async ({ page }) => {
  const email = `e2e-claim-${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Playwright Claimant');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/kyc$/);

  await page.getByLabel('Full legal name').fill('Playwright Claimant');
  await page.getByLabel('Last 4 digits of your ID').fill('1234');
  await page.getByRole('button', { name: 'Start verification' }).click();
  await page.getByRole('button', { name: 'Complete verification (demo)' }).click();
  await expect(page.getByText('Status: VERIFIED')).toBeVisible();

  await page.goto('/policy');
  await page.setInputFiles('input[type="file"]', join(fixturesDir, 'sample-policy.pdf'));
  await expect(page.getByText(/Uploaded sample-policy\.pdf/)).toBeVisible();
  await page.getByLabel('Insurer name').fill('Sandbox Insurance Co');
  await page.getByLabel(/Policy number/).fill('POL-****9012');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Policy saved. You can add another below.')).toBeVisible();

  await page.goto('/claims/new');
  await page.getByLabel('Policy').selectOption({ index: 1 });
  await page.getByLabel('Date of incident').fill('2026-08-01');
  await page.getByLabel('Address').fill('12 MG Road');
  await page.getByLabel('City').fill('Chennai');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('items', { exact: true })).toBeVisible();
  await page.getByLabel('Description').fill('Damaged sofa');
  await page.getByLabel('Category').fill('furniture');
  await page.getByLabel(/Claimed value/).fill('5000');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Damaged sofa (furniture)')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.setInputFiles('input[type="file"]', join(fixturesDir, 'sample-policy.pdf'));
  await expect(page.getByText(/Uploaded sample-policy\.pdf/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText(/1 item\(s\), 1 document\(s\) linked/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit claim' }).click();

  await expect(page).toHaveURL(/\/claims\/[0-9a-f-]+$/);
  await expect(page.getByText('Status: VERIFYING')).toBeVisible();
  await expect(page.getByText('CLAIM_CREATED')).toBeVisible();
  await expect(page.getByText('CLAIM_SUBMITTED')).toBeVisible();
  await expect(page.getByText('VERIFICATION_DISPATCHED')).toBeVisible();

  await page.goto('/claims');
  await expect(page.getByText('VERIFYING')).toBeVisible();
});
