/**
 * Confirms the caller's KYC is verified — by calling identity-service's own
 * API with the caller's access token, never by reading its database
 * (CLAUDE.md invariant 2).
 */
export async function isKycVerified(
  identityServiceUrl: string,
  callerAuthorizationHeader: string,
): Promise<boolean> {
  const response = await fetch(new URL('/v1/kyc/cases/latest', identityServiceUrl), {
    headers: { authorization: callerAuthorizationHeader },
  });
  if (!response.ok) return false;

  const body = (await response.json()) as { kycStatus: string };
  return body.kycStatus === 'VERIFIED';
}
