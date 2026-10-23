# ADR: Auth Runtime Recovery

**Estado:** Vigente

## Decision

Auth must expose session and runtime state through explicit snapshots and outcomes instead of ad hoc `user/null/loading` interpretation.

The canonical runtime contract is:

- session state from `authSession`
- operational state from `authRuntimeSnapshot`
- product-wide aggregation from `clientOperationalRuntimeSnapshot`

Bootstrap, claim resolution, popup/redirect recovery and temporary backend degradation must degrade into controlled states instead of forcing implicit sign-out or UI-local heuristics.

## Why

Auth problems in this app are rarely pure login failures. They usually happen at the boundary between bootstrap timing, local persistence, claim refresh, popup flows and role validation. Without a shared contract, UI and reporters drift and the same incident gets interpreted differently in each layer.

## Source Of Truth

- Session contract: `src/services/auth/authSession.ts`
- Auth runtime snapshot: `src/services/auth/authRuntimeSnapshot.ts`
- Access/role policy:
  - `src/services/auth/authPolicy.ts`
  - `src/services/auth/authAccessResolution.ts`
  - `src/services/auth/authRoleLookup.ts`
- Product-wide runtime snapshot: `src/services/observability/clientOperationalRuntimeSnapshot.ts`

## Invariants

- UI must not infer access policy directly from Firebase user presence.
- Custom claim refresh is allowed to fail in a controlled way without tearing down an otherwise authorized session.
- Auth bootstrap incidents must surface as operational issues before they become a visible hard failure.
- Grace periods around popup/session resolution belong to auth policy/runtime, not to random buttons or screens.

## How To Change Safely

1. If the change affects session semantics, start from `authSession.ts` and `authPolicy.ts`.
2. If the change affects loading/degraded/blocked states, update `authRuntimeSnapshot.ts` and propagate through `clientOperationalRuntimeSnapshot.ts`.
3. If the change affects user feedback, prefer `authUiCopy.ts` and shared notice policy over inline screen-specific messages.
4. If a new auth degradation is introduced, add telemetry and update the auth incident runbook.

## Required Validation

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:release-confidence`
- At least the suites covering:
  - `src/tests/services/auth/authRuntimeSnapshot.test.ts`
  - `src/tests/services/auth/authRuntimeSupport.test.ts`
  - `src/tests/hooks/useAuthState.test.ts`
  - auth risk / login flow tests

## Individual nursing sessions

Managed accounts require a current server authorization version and never reuse a
cached role or repair their claims through the legacy role endpoint. Admission
continues through the same session/storage transition. Password setup is a bounded
server operation; interrupted Auth writes leave access closed until an administrator
repairs the same UID. No clinical source documents are part of that repair.
Session expiry/revocation closes the connected UI while preserving owned pending
edits; backend checks remain authoritative during network interruptions. See
[AUTH_ACCESS_MODEL.md](AUTH_ACCESS_MODEL.md) for activation, private recovery and rollout.
