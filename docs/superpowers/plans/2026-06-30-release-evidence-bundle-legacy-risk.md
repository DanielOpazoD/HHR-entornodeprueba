# Release Evidence Bundle Legacy Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one focused technical PR that keeps release evidence fresh, reduces bundle/chunk risk before it blocks release, and records a short legacy retirement plan.

**Architecture:** Keep behavior unchanged. Move audit writer loading behind a shared async loader so the hook and fail-closed use cases use one lazy boundary. Keep heavyweight browser capabilities behind explicit chunk policies and isolate HEIC conversion behind a small service boundary. Record legacy retirement scope as documentation, not a broad refactor.

**Tech Stack:** React 19, TypeScript, Vite/Rollup manual chunks, Vitest, existing HHR guardrail scripts.

---

### Task 1: Audit Writer Lazy Boundary

**Files:**

- Create: `src/application/audit/writeAuditEventUseCaseLoader.ts`
- Modify: `src/hooks/useAudit.ts`
- Modify: `src/application/prescriptions/deletePrescriptionUseCase.ts`
- Modify: `src/application/medical-indications/medicalIndicationsUseCases.ts`
- Modify: `src/application/clinical-documents/clinicalDocumentUseCases.ts`
- Modify: `src/application/daily-record/commands/admitPatientCommand.ts`
- Modify: `src/application/daily-record/commands/deleteDailyRecordCommand.ts`
- Modify: `src/features/census/controllers/dischargeCanonicalAdoptionController.ts`
- Modify: `src/features/census/controllers/transferCanonicalAdoptionController.ts`
- Modify: `src/services/repositories/ports/repositoryAuditPort.ts`
- Test: `src/tests/build/chunkingPolicy.test.ts`

- [ ] Add a failing structural test asserting no production source value-imports `executeWriteAuditEvent` directly from `writeAuditEventUseCase`, except the loader and use-case implementation.
- [ ] Run `npx vitest run src/tests/build/chunkingPolicy.test.ts` and confirm that new assertion fails on current static imports.
- [ ] Add `loadWriteAuditEventUseCase()` and `loadExecuteWriteAuditEvent()` in `writeAuditEventUseCaseLoader.ts`.
- [ ] Convert default audit writer resolution in the listed use cases to `await loadExecuteWriteAuditEvent()` when no injected writer is provided.
- [ ] Keep dependency injection types intact with type-only imports from `writeAuditEventUseCase`.
- [ ] Re-run `npx vitest run src/tests/build/chunkingPolicy.test.ts src/tests/application/audit/writeAuditEventUseCase.test.ts src/tests/application/daily-record/commands/admitPatientCommand.test.ts src/tests/application/daily-record/deleteDailyRecordCommand.test.ts src/tests/application/prescriptions/prescriptionUseCases.test.ts src/tests/application/medical-indications/medicalIndicationsUseCases.test.ts src/tests/application/clinical-documents/clinicalDocumentDeleteUseCase.test.ts`.

### Task 2: Heavy Capability Chunk Policy

**Files:**

- Modify: `scripts/config/chunkingPolicy.ts`
- Modify: `scripts/config/bundle-budget.json`
- Modify: `vite.config.ts`
- Modify: `src/tests/build/chunkingPolicy.test.ts`
- Modify: `src/features/prescriptions/services/prescriptionImageCompressionService.ts`
- Create: `src/features/prescriptions/services/prescriptionHighEfficiencyImageConverter.ts`

- [ ] Add failing tests for explicit `heic2any` and `pdfjs-dist` manual chunks.
- [ ] Add a failing test that `prescriptionImageCompressionService.ts` no longer imports `heic2any` directly and the new converter module owns that import.
- [ ] Implement `vendor-pdfjs` and `heic2any` chunk routing in `chunkingPolicy.ts`.
- [ ] Add `vendor-pdfjs` to PWA precache ignores and bundle budgets.
- [ ] Move HEIC conversion import into `prescriptionHighEfficiencyImageConverter.ts`.
- [ ] Re-run focused prescription image and chunking tests.

### Task 3: Legacy Retirement Plan

**Files:**

- Create: `docs/LEGACY_RETIREMENT_PLAN.md`
- Create or modify: `src/tests/build/legacyRetirementPlan.test.ts`

- [ ] Add a failing test requiring the plan to name the three active priorities: legacy read bridge, role aliases, and legacy clinical document/episode hydration.
- [ ] Write the plan with scope, non-goals, phases, and closure signals.
- [ ] Re-run `npx vitest run src/tests/build/legacyRetirementPlan.test.ts`.

### Task 4: Verification and PR

**Files:**

- Generated reports may update if strict freshness requires it.

- [ ] Run `npm run build`.
- [ ] Run `npm run check:bundle-budget`.
- [ ] Run `npm run check:chunk-graph`.
- [ ] Run `npm run check:clinical-mutation-audit-policy`.
- [ ] Run `npm run check:report-freshness:strict`.
- [ ] Run `npm run typecheck`.
- [ ] Commit, push, and open a draft PR to `main`.
