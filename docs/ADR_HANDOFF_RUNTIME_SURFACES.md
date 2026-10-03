# ADR: Handoff Runtime Surfaces

**Estado:** Vigente

## Decision

`handoff` must be changed through stable runtime surfaces:

- feature screens stay presentational
- screen orchestration belongs in local feature hooks
- business rules live in `application/handoff` and `domain/handoff`
- deprecated controllers remain compatibility bridges only
- external consumers enter through `src/features/handoff/public.ts`

## Why

`handoff` mixes nurse delivery, medical handoff, continuity rules, audit payloads, day-scoped editing restrictions and legacy bridges. The feature becomes expensive to evolve when screens, controllers and domain rules all coordinate the same behavior.

## Source Of Truth

- Public surface: `src/features/handoff/public.ts`
- Screen composition: feature hooks such as `useHandoffViewScreenModel`
- Business rules:
  - `src/application/handoff`
  - `src/domain/handoff`
- Compatibility-only bridges: `src/features/handoff/controllers`

## Invariants

- New business rules do not enter deprecated controllers.
- Screen `.tsx` files should consume read models/bindings, not recreate policy decisions.
- Day restrictions and specialist restrictions must be enforced both in visible UI flow and mutation layer.
- Audit-compatible payload shape must be preserved while legacy consumers still exist.
- Record changes and persistence use `application/handoff/handoffManagementUseCases.ts`;
  `handoffManagementPersistenceController.ts` only builds audit payloads. Do not
  restore test-only persistence builders alongside the canonical use cases.

## How To Change Safely

1. If a screen becomes too orchestration-heavy, extract a local screen model hook before editing JSX further.
2. If the rule affects handoff semantics, prefer `application/handoff` or `domain/handoff` over feature controllers.
3. If a legacy bridge is still required, keep it explicitly documented and test-only or adapter-scoped when possible.
4. If a new external consumer appears, expose what it needs from `public.ts` instead of importing internals.

## Required Validation

- `npm run typecheck`
- `npm run check:quality`
- relevant `handoff` application/domain/view tests
- `npm run check:handoff-feature-boundary`
