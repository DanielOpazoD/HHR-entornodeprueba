# Debt And Handoff Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Bloque 1 and Bloque 2 with small, evidence-backed changes that reduce structural debt and clinical operational risk.

**Architecture:** Follow the repo guardrails: pure controllers/helpers before JSX or public-contract changes, no new broad layer, and handoff rules through stable runtime surfaces. Each block gets a focused test first, a minimal implementation, and a registry/checklist update.

**Tech Stack:** Vite, React, TypeScript, Vitest, repo guardrails in `scripts/check-*.mjs` and `docs/*`.

---

## Internal Mandatory Inputs

- `docs/QUALITY_GUARDRAILS.md`: prefer controller/helper extraction; keep lint/typecheck/check-quality green; watch hotspot growth.
- `docs/TECHNICAL_DEBT_REGISTER.md`: active foundation convergence and operational policy facades remain protected.
- `docs/MAINTENANCE_ITERATION_LOG.md`: each iteration must be small, verifiable, and recorded with commands and next step.
- `docs/SAFE_CHANGE_CHECKLIST.md`: classify change, update tests, run typecheck/check-quality, and validate handoff-specific checks when touching handoff.
- `docs/ADR_HANDOFF_RUNTIME_SURFACES.md`: handoff business rules stay in stable application/domain/access surfaces, not ad hoc JSX.
- `docs/HANDOFF_SPECIALIST_MEDICAL_WRITE_PATH.md`: specialist handoff historical-edit denial must remain explicit and regression-tested.

## Iteration Loop

For each block:

1. Pick one observable risk from current reports/docs.
2. Write or extend a focused failing test.
3. Run the focused test and verify the expected failure.
4. Implement the smallest controller/helper change.
5. Rerun focused tests.
6. Update `docs/MAINTENANCE_ITERATION_LOG.md`.
7. Run the block-specific guardrail.
8. Continue to the next block only after green evidence.

## Bloque 1: IndexedDB Core Responsibility Reduction

**Files:**

- Create: `src/services/storage/indexeddb/indexedDbOpenWaitController.ts`
- Test: `src/tests/services/storage/indexedDbOpenWaitController.test.ts`
- Modify: `src/services/storage/indexeddb/indexedDbCore.ts`
- Modify: `docs/MAINTENANCE_ITERATION_LOG.md`

**Risk addressed:** `reports/architectural-hotspots.md` marks `src/services/storage/indexeddb/indexedDbCore.ts` as `reduce-responsibility`; concurrent-open fallback decisions are still inline in the core orchestrator.

**Steps:**

- [ ] Add failing Vitest coverage for resolving `opened`, `mock`, `stalled`, and `settled` wait outcomes into explicit actions.
- [ ] Implement `resolveIndexedDbOpenWaitAction(...)` as a pure controller returning `return`, `fallback`, or `continue`.
- [ ] Replace the inline `waitForIndexedDbOpenResolution(...)` branching in `indexedDbCore.ts` with the controller.
- [ ] Run `npx vitest run src/tests/services/storage/indexedDbOpenWaitController.test.ts src/tests/services/storage/indexedDbCoreSupport.test.ts src/tests/services/storage/indexedDbInitialOpenRecoveryController.test.ts`.
- [ ] Run `node scripts/check-hotspot-growth.mjs`.

## Bloque 2: Handoff Specialist Historical-Edit Denial Contract

**Files:**

- Create: `src/features/handoff/controllers/handoffSpecialistHistoricalEditNoticeController.ts`
- Test: `src/tests/views/handoff/handoffSpecialistHistoricalEditNoticeController.test.ts`
- Modify: `src/hooks/useHandoffPersistenceRuntime.ts`
- Modify: `src/hooks/useHandoffManagementDelivery.ts`
- Modify: `docs/MAINTENANCE_ITERATION_LOG.md`

**Risk addressed:** the specialist previous-day denial is duplicated across persistence and delivery paths. That is small today, but clinically relevant: if messages/outcomes drift, some blocked edits may become silent or inconsistent.

**Steps:**

- [ ] Add failing Vitest coverage for one shared denial notice and one shared permission failed outcome.
- [ ] Implement a tiny controller that exports the stable title/message and builds the permission failure outcome.
- [ ] Replace duplicated strings in persistence and delivery paths with the shared controller.
- [ ] Run `npx vitest run src/tests/views/handoff/handoffSpecialistHistoricalEditNoticeController.test.ts src/tests/hooks/useHandoffManagement.test.ts src/tests/views/handoff/medicalHandoffAccessController.test.ts`.
- [ ] Run `npm run check:handoff-feature-boundary`.

## Closeout

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run check:quality`.
- [ ] Run `npm run report:maintenance-debt-scorecard`.
- [ ] Run `npm run check:report-freshness`.
- [ ] Commit and push.
