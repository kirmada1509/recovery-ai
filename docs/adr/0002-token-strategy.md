# ADR 0002 — Token strategy and session security

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Section 2.5

## Context

Victims may be using shared or borrowed devices in a disaster context. Session
compromise is a realistic threat, and the research reports proposed refresh-token
lifetimes ranging from 7 to 30 days with varying rotation discipline.

## Decision

- Access token: JWT, ~15 minute TTL, carrying `sub`, `role`, `session_id`,
  `token_version`, `iat`, `exp`, `iss`, `aud`.
- Refresh token: opaque high-entropy value, ~30 day TTL, **hashed at rest**, rotated
  on every use.
- Reuse of an already-rotated refresh token revokes the entire token family.
- Browser storage is a secure, `HttpOnly`, `SameSite=Lax`-or-stricter cookie. Never
  `localStorage`.
- Passwords are hashed with Argon2id.
- The insurer sandbox and the regulator sandbox each run a separate realm: their own
  users, signing keys, issuer, audience and cookies. No shared session with RecoveryAI.
- Service-to-service calls use an internal service credential with an explicit
  audience. End-user refresh tokens are never forwarded between services.

## Consequences

- A stolen refresh token is detectable: replaying it kills the family and forces
  re-authentication, which is the behaviour we want on a shared device.
- Rotation means the client must handle a rotating cookie correctly on every refresh;
  integration tests cover rotation, reuse detection and logout-all.
- Three auth realms mean three sets of fixtures and three login flows in E2E tests.
  That cost is deliberate: it proves the sandboxes are genuinely external parties.
