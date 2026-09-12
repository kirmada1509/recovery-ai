import { expect, test } from '@playwright/test';

/**
 * Phase 1 gate (plan Section 18, P1): signup, complete mock KYC, refresh a
 * session, log out, and confirm protected-route behavior.
 */
test('victim onboarding: signup, KYC, session refresh, logout, protected routes', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Full name').fill('Playwright Victim');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();

  await expect(page).toHaveURL(/\/kyc$/);
  await expect(page.getByText('Status: UNVERIFIED')).toBeVisible();

  await page.getByLabel('Full legal name').fill('Playwright Victim');
  await page.getByLabel('Last 4 digits of your ID').fill('1234');
  await page.getByRole('button', { name: 'Start verification' }).click();
  await expect(page.getByText('Status: PENDING')).toBeVisible();

  await page.getByRole('button', { name: 'Complete verification (demo)' }).click();
  await expect(page.getByText('Status: VERIFIED')).toBeVisible();

  // A full page reload discards the in-memory access token (it is never
  // stored in localStorage — plan Section 14.1) and forces the silent
  // refresh flow to run on the httpOnly refresh cookie. Staying signed in
  // here is the refresh-rotation path actually working end to end.
  await page.reload();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Status: VERIFIED')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();

  // Logged out: a protected route must never render, only redirect.
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login$/);
});
