# Clinical Documents Convergence And Runtime Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove remaining structural exceptions in clinical documents and gain startup/runtime margin without adding product features.

**Architecture:** Work in narrow behavior-preserving slices. Each slice must reduce a measured hotspot, keep public imports stable, and pass focused tests before moving on.

**Tech Stack:** React, TypeScript, Vitest, Vite, existing HHR quality/reporting scripts.

---

### Task 1: Split Clinical Document Indications Catalog Pure Logic

**Objective:** Move pure catalog normalization/mutation helpers out of the oversized controller while keeping the current controller public API stable.

**Files:**

- Create: `src/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogModel.ts`
- Modify: `src/features/clinical-documents/controllers/clinicalDocumentIndicationsCatalogController.ts`
- Test: `src/tests/features/clinical-documents/clinicalDocumentIndicationsCatalogController.test.ts`

- [x] Run the focused controller test as the RED/baseline guard:
      `npx vitest run src/tests/features/clinical-documents/clinicalDocumentIndicationsCatalogController.test.ts`
- [x] Move model types, default builders, and normalization helpers into the new model file.
- [x] Re-export the same public symbols from `clinicalDocumentIndicationsCatalogController.ts`.
- [x] Run the focused controller test and `npm run check:module-size`.
- [x] Remove the controller allowlist entry if it falls under 400 lines.

### Task 2: Split Clinical Document Indications Catalog Service Operations

**Objective:** Reduce the service hotspot by moving repeated load-save mutation orchestration into a focused helper.

**Files:**

- Create: `src/features/clinical-documents/services/clinicalDocumentIndicationsCatalogOperations.ts`
- Modify: `src/features/clinical-documents/services/clinicalDocumentIndicationsCatalogService.ts`
- Test: `src/tests/features/clinical-documents/clinicalDocumentIndicationsCatalogService.test.ts`

- [x] Run the focused service test as the RED/baseline guard:
      `npx vitest run src/tests/features/clinical-documents/clinicalDocumentIndicationsCatalogService.test.ts`
- [x] Extract reusable `load -> apply -> save if changed` operations.
- [x] Keep exported service functions and hook imports unchanged.
- [x] Run service tests and `npm run check:module-size`.
- [x] Remove the service allowlist entry if it falls under 400 lines.

### Task 3: Split Plan Section DOM Helpers

**Objective:** Reduce the plan-section hotspot by extracting parsing/append DOM helpers without changing content output.

**Files:**

- Create: `src/features/clinical-documents/controllers/clinicalDocumentPlanSectionDom.ts`
- Modify: `src/features/clinical-documents/controllers/clinicalDocumentPlanSectionController.ts`
- Test: `src/tests/features/clinical-documents/clinicalDocumentPlanSectionController.test.ts`

- [x] Run the focused plan section test as the RED/baseline guard:
      `npx vitest run src/tests/features/clinical-documents/clinicalDocumentPlanSectionController.test.ts`
- [x] Extract DOM normalization and append helpers.
- [x] Keep existing controller exports stable.
- [x] Run focused tests and `npm run check:module-size`.
- [x] Remove the plan-section allowlist entry if it falls under 400 lines.

### Task 4: Runtime Margin Review

**Objective:** Identify one low-risk import deferral or bundle boundary cleanup if `app-authenticated-shell` still has near-limit pressure.

**Files:** To be selected from current build output only.

- [x] Run `npm run build` and `npm run check:bundle-budget`.
- [x] Evaluate whether a clear no-behavior import deferral exists.
- [x] Document the current bundle pressure and stop because no safe seam was clear enough for this
      slice.

**Runtime note:** Build and bundle budget pass. `app-authenticated-shell` remains near limit at
525.6 KB / 546.9 KB (96.1%). The remaining obvious candidates are shell overlays/runtime hooks
with live sync, lock, notification, and export responsibilities, so this slice intentionally stops
instead of deferring security or operational UI with weak evidence.

### Task 5: Final Closure

**Objective:** Prove the branch is smaller, governed, and safe.

- [x] Run focused clinical-documents tests.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint -- --max-warnings 0`.
- [x] Run `npm run check:quality`.
- [x] Run `npm run build`.
- [x] Run `npm run check:bundle-budget`.
- [x] Run `npm run test:ci:unit` if the branch changes shared behavior.
- [x] Evaluate report freshness and defer refresh until PR finalization.

**Closure note:** Report freshness remains advisory while the branch is uncommitted because existing
report artifacts recorded a clean worktree. Refresh them at the PR-finalization point after the
code diff is stable.

### Preventive Hardening Pass

**Objective:** Add low-cost regression coverage for the refactor seams most likely to drift.

- [x] Cover that no-op personal indication mutations do not persist a catalog rewrite.
- [x] Cover that legacy free text before structured plan headings remains in general indications.
- [x] Cover that appended plain-text plan indications are escaped before becoming HTML.

---

## Block 2: Foundations Convergence And Evidence

**Goal:** Make the branch more ambitious without adding product features: align governance evidence,
retire one low-risk compatibility shim, add content-loss protection coverage, and document bundle
margin with current build facts.

**Architecture:** Keep the changes measurable and behavior-preserving. Prefer config/report cleanup,
tests around existing clinical-document safety contracts, and conservative bundle analysis over broad
runtime rewrites.

### Task 6: Retire Unused Legacy Firestore Compatibility Shim

**Objective:** Remove the deprecated `legacyFirestoreBridge` entry now that it has no active source
importers and the narrow bridges are the canonical paths.

**Files:**

- Delete: `src/services/storage/migration/legacyFirestoreBridge.ts`
- Modify: `scripts/config/compatibility-governance.json`
- Modify: `scripts/check-storage-context-boundaries.mjs`
- Modify: storage/repository docs that still name the retired shim

- [x] Confirm no active source importers with `rg -n "legacyFirestoreBridge" src scripts functions netlify`.
- [x] Remove the retired compatibility entry from `scripts/config/compatibility-governance.json`.
- [x] Remove the retired file from storage boundary exceptions.
- [x] Update docs to point readers at `legacyRecordReadBridge` and `legacyCatalogReadBridge`.
- [x] Run compatibility and boundary checks.

### Task 7: Add Clinical Content-Loss Regression Coverage

**Objective:** Lock the existing draft reducer safety contract around staged remote updates, template
restore, and document switching.

**Files:**

- Modify: `src/tests/features/clinical-documents/clinicalDocumentDraftReducer.test.ts`

- [x] Add reducer coverage proving template restore does not discard a staged remote update.
- [x] Add reducer coverage proving `LOAD_DOCUMENT` with `commitAsBase: false` swaps visible draft
      without clearing the current base or staged remote state.
- [x] Run the reducer test and focused clinical-document tests.

### Task 8: Refresh Governance Evidence

**Objective:** Regenerate current governance reports after the module-size allowlist and compatibility
inventory changed.

**Files:**

- Modify generated report artifacts under `reports/`

- [x] Run report scripts for quality metrics, compatibility governance, compatibility import
      governance, maintenance debt, architectural hotspots, and release readiness if needed.
- [x] Run `npm run check:report-freshness` and document any remaining advisory state.

**Evidence note:** `check:report-freshness` is now OK for the dirty worktree. The refreshed reports
record zero module allowlist hotspots and four compatibility governance entries after retiring the
unused storage shim.

### Task 9: Bundle Margin Audit

**Objective:** Inspect current build output for a clear behavior-preserving deferral seam. Only change
code if there is an obvious low-risk import split.

- [x] Run `npm run build` and `npm run check:bundle-budget`.
- [x] Inspect largest generated assets and package/module contributors from available build output.
- [x] If no safe seam is obvious, document the decision and keep runtime unchanged.

**Bundle audit note:** Build and bundle budget pass. The largest budgeted pressure remains
`vendor/exceljs.min.js` at 925.5 KB (94.8%) and `app-authenticated-shell` at 525.6 KB (96.1%).
The current chunking policy already isolates Excel, PDF, Firebase, local DB, and feature view
entrypoints; the remaining shell chunk is the explicitly governed app shell/runtime/AppContent
surface. No behavior-preserving import deferral was clear enough to justify a runtime change in
this branch.

### Task 10: Block 2 Closure

**Objective:** Prove this expanded branch remains safe.

- [x] Run focused tests touched by Block 2.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint -- --max-warnings 0`.
- [x] Run `npm run check:quality`.
- [x] Run `npm run build`.
- [x] Run `npm run check:bundle-budget`.
- [x] Run `npm run test:ci:unit` if Block 2 changes shared behavior.

**Closure evidence:** Focused clinical-document draft reducer/remote-sync tests passed
(37 tests). The explicit `typecheck`, strict `lint`, full `check:quality`, production build,
bundle budget, and full unit CI suite all pass. The final unit suite reports 1271 passed test
files and 7013 passed tests.
