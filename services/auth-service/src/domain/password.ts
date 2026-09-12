/**
 * Argon2id password hashing (plan Section 2.5). Bun's built-in `Bun.password`
 * implements Argon2id natively, so no additional dependency is needed.
 */
const ARGON2_OPTIONS = {
  algorithm: 'argon2id',
  memoryCost: 19456,
  timeCost: 2,
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plaintext, hash);
}
