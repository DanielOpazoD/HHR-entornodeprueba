# Professional Stability Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ejecutar seis mejoras de alto valor para que la app se sienta más profesional, estable y mantenible sin sobreingeniería.

**Architecture:** Mantener los guardrails existentes como fuente de verdad y agregar mejoras pequeñas con evidencia directa. Cada bloque debe tener prueba o gate propio: audit reproducible, QA visual clínico, payload/chunk policy, UX de contenedores, contratos Excel y documentación operativa.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright, Vite, ExcelJS, scripts Node ESM.

---

### Task 1: Dependency Audit Reproducibility

**Files:**

- Modify: `scripts/lib/dependencyAuditSupport.mjs`
- Modify: `scripts/check-dependency-vulnerabilities.mjs`
- Test: `src/tests/build/dependencyAuditSupport.test.ts`

- [x] **Step 1: Write failing tests** for reproducibility metadata and markdown output.
- [x] **Step 2: Verify red** with `npx vitest run src/tests/build/dependencyAuditSupport.test.ts`.
- [x] **Step 3: Implement metadata** with exact local commands, CI evidence expectation and forbidden unsafe bypasses.
- [x] **Step 4: Verify green** with the targeted Vitest command.

### Task 2: Browser Policy And Visual QA Scope

**Files:**

- Modify: `playwright.config.ts`
- Modify: `e2e/clinical-release-visual-smoke.spec.ts`
- Test: `src/tests/build/e2eBrowserPolicy.test.ts`

- [x] **Step 1: Write failing static tests** requiring Chromium default and cross-browser opt-in.
- [x] **Step 2: Implement browser selection** via `E2E_BROWSERS`, keeping fallback Chromium.
- [x] **Step 3: Add CUDYR to clinical visual smoke** and keep overflow evidence attached.
- [x] **Step 4: Verify green** with `npx vitest run src/tests/build/e2eBrowserPolicy.test.ts`.

### Task 3: Payload Guardrail Tightening

**Files:**

- Modify: `scripts/config/bundle-budget.json`
- Test: `src/tests/build/bundleBudgetConfig.test.ts`

- [x] **Step 1: Tighten warning/ceiling where current build has headroom** without breaking the last measured build.
- [x] **Step 2: Verify with** `npm run build && npm run check:bundle-budget && npm run check:chunk-graph`.

### Task 4: Clinical UX Containment

**Files:**

- Modify: `src/features/clinical-documents/components/ClinicalAttachmentRow.tsx`
- Test: `src/tests/features/clinical-documents/ClinicalAttachmentsPanel.test.tsx`

- [x] **Step 1: Write failing test** for row containment class.
- [x] **Step 2: Add stable row class with `min-w-0` and `overflow-hidden`**.
- [x] **Step 3: Verify green** with the clinical attachments panel test.

### Task 5: CUDYR Excel Export Hardening

**Files:**

- Modify: `src/services/cudyr/cudyrExportService.ts`
- Modify: `src/services/cudyr/cudyrWorkbookBuilder.ts`
- Test: `src/tests/services/exporters/cudyrExportService.test.ts`
- Test: `src/tests/services/cudyrWorkbookBuilder.test.ts`

- [x] **Step 1: Write failing tests** for invalid blob rejection, workbook active tab and frozen panes.
- [x] **Step 2: Share validation before download/upload blob paths**.
- [x] **Step 3: Set workbook view and daily-sheet frozen panes**.
- [x] **Step 4: Verify green** with targeted CUDYR tests.

### Task 6: Operational Documentation

**Files:**

- Modify: `docs/DEVELOPER_COMMANDS.md`
- Modify: `docs/testing/VRT.md`
- Modify: `docs/CI_GATES_AND_FAILURE_RUNBOOKS.md`

- [x] **Step 1: Document Chromium default and cross-browser opt-in**.
- [x] **Step 2: Document expanded clinical visual smoke scope**.
- [x] **Step 3: Document dependency audit repro evidence**.
- [x] **Step 4: Run docs drift and operational runbook checks**.
