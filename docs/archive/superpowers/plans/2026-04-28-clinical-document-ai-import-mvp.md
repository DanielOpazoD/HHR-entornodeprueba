# Clinical Document AI Import MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first AI-assisted import flow that turns extracted PDF/DOCX transfer-report text into an editable `epicrisis_traslado` draft.

**Architecture:** Keep AI transformation behind a dedicated Netlify Function and keep the frontend workflow inside `clinical-documents`. The Function returns a simplified JSON contract; frontend controllers validate and map it into document sections, then existing workspace save/select behavior opens the generated draft.

**Tech Stack:** React, TypeScript, Vitest, Zod, Netlify Functions, existing `ai-provider`, `pdfjs-dist`, lazy DOCX extraction.

---

### Task 1: Internal Import Contract And Mapper

**Files:**

- Create: `src/features/clinical-documents/controllers/clinicalDocumentAiImportController.ts`
- Test: `src/tests/features/clinical-documents/clinicalDocumentAiImportController.test.ts`

- [ ] Write failing tests for simplified JSON validation, section mapping, file validation, and source text validation.
- [ ] Run: `npx vitest run src/tests/features/clinical-documents/clinicalDocumentAiImportController.test.ts`
- [ ] Implement the controller with small pure functions.
- [ ] Re-run the focused test and keep it green.

### Task 2: Serverless AI Transform Endpoint

**Files:**

- Modify: `src/contracts/serverless.ts`
- Create: `netlify/functions/clinical-document-ai-import.ts`
- Test: `src/tests/netlify/clinicalDocumentAiImport.test.ts`

- [ ] Write failing tests for `available: false`, invalid payload, authorized transformation, and invalid AI JSON.
- [ ] Run: `npx vitest run src/tests/netlify/clinicalDocumentAiImport.test.ts`
- [ ] Implement request/response schemas, prompt builder, parser, auth/rate-limit, provider invocation, and safe errors.
- [ ] Re-run the focused Netlify test and keep it green.

### Task 3: Frontend Services And Workspace Action

**Files:**

- Create: `src/features/clinical-documents/services/clinicalDocumentAiFileTextService.ts`
- Create: `src/features/clinical-documents/services/clinicalDocumentAiImportService.ts`
- Modify: `src/features/clinical-documents/hooks/useClinicalDocumentWorkspaceDocumentActions.ts`
- Test: `src/tests/features/clinical-documents/useClinicalDocumentWorkspaceDocumentActions.test.tsx`

- [ ] Write failing tests around successful AI import creating/selecting a draft and failed import showing recoverable error.
- [ ] Run the focused workspace action test.
- [ ] Implement local PDF/DOCX/text extraction service, Function caller, and `handleImportWithAi`.
- [ ] Re-run the focused test and keep it green.

### Task 4: Sidebar UI Entry Point

**Files:**

- Modify: `src/features/clinical-documents/contracts/clinicalDocumentsSidebarContracts.ts`
- Modify: `src/features/clinical-documents/controllers/clinicalDocumentsWorkspaceViewModel.ts`
- Modify: `src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts`
- Modify: `src/features/clinical-documents/components/ClinicalDocumentsSidebar.tsx`
- Test: sidebar/workspace tests already covering sidebar props plus a focused render test if needed.

- [ ] Write failing UI/props test for an `Importar con IA` file entry accepting PDF/DOCX.
- [ ] Implement hidden file input and visible action button in advanced tools.
- [ ] Wire `handleImportWithAi` through the workspace model and sidebar props.
- [ ] Re-run focused clinical-documents tests.

### Task 5: Validation

**Files:**

- Verify changed code only.

- [ ] Run: `npm run test:clinical-documents`
- [ ] Run: `npx vitest run src/tests/netlify/clinicalDocumentAiImport.test.ts`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run lint -- --max-warnings 0`
- [ ] Review `git diff` for unrelated churn.
