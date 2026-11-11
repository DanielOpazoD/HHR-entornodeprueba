# Netlify Auth Role Convergence Design

Date: 2026-04-21
Status: proposed

## Problem

The app authorizes the main shell correctly through the canonical login flow:

- Google / Firebase Auth
- frontend calls `checkUserRole`
- Firebase Functions resolves the current email against `config/roles`

But Netlify Functions used by `LAB` and `MMRAD` can still reject a user that is already authorized for the shell. In the current incident, `daniel.opazo@hospitalhangaroa.cl` exists in `config/roles` as `admin`, the shell login succeeds, yet `syslab-proxy` returns `Access denied for role 'unauthorized'`.

This means Netlify serverless auth is not converging reliably with the canonical role-resolution path.

## Goal

Make `syslab-proxy` and `mmrad-search` resolve the caller role from the same canonical backend path as general login, so an authorized user does not succeed in shell auth and fail in Netlify Functions for the same session.

## Non-goals

- Do not relax `firestore.rules`.
- Do not add new hardcoded allowlists.
- Do not change the source of truth away from `config/roles`.
- Do not expand `LAB` or `MMRAD` permissions beyond the already-approved read-only access.

## Recommended approach

Introduce a convergent server-side role lookup for Netlify Functions that does not depend on a fragile Firestore client read from inside the Netlify runtime.

The simplest safe path is:

1. Add a reusable role-resolution function in Firebase callable/auth backend terms.
2. Make Netlify auth authorization use that same canonical lookup path.
3. Keep the allowed-role sets in each Netlify function unchanged except for the already-approved `viewer` access.

This is preferred over patching messages or weakening Firestore rules because the real bug is authorization drift between backends.

## Architecture

### Current state

- General login:
  - `src/services/auth/authRoleLookup.ts`
  - Firebase callable `checkUserRole`
  - backend resolves `config/roles`
- Netlify functions:
  - `netlify/functions/lib/firebase-auth.ts`
  - verifies bearer token
  - resolves email
  - performs an internal role lookup that can fall back to `unauthorized`

### Desired state

Both paths converge on one canonical role resolution policy:

- email normalization
- legacy alias normalization (`viewer_census -> viewer`)
- `config/roles` lookup
- allowed-role validation per endpoint

The Netlify side should consume a server-safe runtime for role resolution, not its own partially divergent read path.

## Files in scope

Primary:

- `netlify/functions/lib/firebase-auth.ts`
- `netlify/functions/syslab-proxy.ts`
- `netlify/functions/mmrad-search.ts`

Supporting:

- `src/tests/netlify/firebaseAuth.test.ts`
- `src/tests/netlify/syslabProxy.test.ts`
- `src/tests/netlify/mmradSearch.test.ts`

Potential shared extraction if needed:

- `netlify/functions/lib/authRoleResolution.ts`
  or
- `functions/lib/auth/*` if there is already a reusable server-safe helper with the same semantics

## Data flow

### Before

1. Browser gets Firebase ID token.
2. Browser calls Netlify function with bearer token.
3. Netlify function verifies token.
4. Netlify auth helper resolves role through its own lookup path.
5. Lookup may incorrectly degrade to `unauthorized`.

### After

1. Browser gets Firebase ID token.
2. Browser calls Netlify function with bearer token.
3. Netlify function verifies token.
4. Netlify auth helper resolves email through the canonical backend-compatible role lookup.
5. Endpoint validates role against its allowed-role set.
6. Authorized users reach `LAB` / `MMRAD` consistently with shell login.

## Error handling

- Preserve `401` for missing or malformed bearer token.
- Preserve `403` for authenticated users whose role is not allowed.
- Improve the `403` user-facing message when the role lookup fails to find the user, so the app says the issue is either:
  - email not present in `config/roles`
  - session/token mismatch with the current environment
- Do not silently fall back to stale claims as the primary authorization source for Netlify endpoints.

## Testing

Required automated coverage:

1. `firebase-auth` unit tests
   - authorized email in canonical role map returns the expected role
   - legacy alias still normalizes correctly
   - non-authorized email remains denied

2. `syslab-proxy`
   - authorized admin user succeeds
   - authorized viewer user succeeds
   - unauthorized user remains blocked before upstream access

3. `mmrad-search`
   - same coverage pattern as `syslab-proxy`

4. Regression guard
   - add a test for the exact incident shape: shell-authorized email in `config/roles` must not degrade to `unauthorized` inside Netlify auth

Validation gates after implementation:

- targeted Vitest suites for Netlify auth + `syslab` + `mmrad`
- `npm run typecheck`

## Risks

- Auth is a sensitive boundary, so the change must stay narrow.
- Reusing stale token claims as the main source would make revocation weaker. Avoid that.
- If there is hidden divergence between Firebase Functions and Netlify Functions, tests must pin the canonical semantics before refactor.

## Rollout

1. Extract or replace the Netlify role lookup with the canonical server-safe path.
2. Update `syslab-proxy` and `mmrad-search` to use it.
3. Add regression tests for the incident.
4. Validate locally in `netlify dev` with `localhost:8888`.

## Success criteria

- A user present in `config/roles` with a general-login role can enter shell and use `LAB` / `MMRAD` in the same local session.
- `LAB` no longer returns `Access denied for role 'unauthorized'` for `daniel.opazo@hospitalhangaroa.cl`.
- Unauthorized users are still rejected with `403`.
