# Clinical Attachments Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first vertical version of clinical attachments: metadata in Firestore, files in Firebase Storage, a panel in the clinical-documents workspace, image compression policy, and safer paste behavior.

**Architecture:** Keep `ClinicalDocumentRecord` lightweight. Add a separate `ClinicalAttachmentRecord` contract indexed by `hospitalId`, `patientRut`, and `episodeKey`; store binaries under `clinical-attachments/{hospitalId}/{patientRutKey}/{episodeKey}/{attachmentId}/{safeFileName}`. UI uses feature hooks/use-cases; Firebase access stays in repository/runtime services.

**Tech Stack:** React, TypeScript, Zod, Firebase Firestore, Firebase Storage, Vitest, existing application outcome contracts.

---

### Task 1: Attachment Domain, Policy, and Rules

**Files:**

- Create: `src/features/clinical-documents/domain/clinicalAttachmentTypes.ts`
- Create: `src/features/clinical-documents/contracts/clinicalAttachmentRuntimeContracts.ts`
- Create: `src/features/clinical-documents/controllers/clinicalAttachmentFilePolicy.ts`
- Create: `src/features/clinical-documents/controllers/clinicalAttachmentPathController.ts`
- Modify: `src/features/clinical-documents/domain/entities.ts`
- Modify: `storage.rules`
- Test: `src/tests/features/clinical-documents/clinicalAttachmentFilePolicy.test.ts`
- Test: `src/tests/features/clinical-documents/clinicalAttachmentPathController.test.ts`
- Test: `src/tests/features/clinical-documents/clinicalAttachmentRuntimeContracts.test.ts`
- Test: `src/tests/security/rulesHardeningStatic.test.ts`

- [ ] **Step 1: Write failing tests for limits, path normalization, runtime contract, and Storage rules.**

  Run:

  ```bash
  npx vitest run src/tests/features/clinical-documents/clinicalAttachmentFilePolicy.test.ts src/tests/features/clinical-documents/clinicalAttachmentPathController.test.ts src/tests/features/clinical-documents/clinicalAttachmentRuntimeContracts.test.ts src/tests/security/rulesHardeningStatic.test.ts
  ```

  Expected: fails because modules and rules do not exist.

- [ ] **Step 2: Implement domain contracts and policies.**

  Required constants:

  ```ts
  CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES = 500 * 1024;
  CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
  CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
  ```

  Required file decisions:
  - image `<= 500 KB`: `inline_image`
  - image `> 500 KB && <= 2 MB`: `storage_image`
  - image `> 2 MB && <= 10 MB`: `compress_image`
  - PDF/DOCX `<= 15 MB`: `storage_file`
  - unsupported or too large: `rejected`

- [ ] **Step 3: Add Storage rules for `clinical-attachments`.**

  Rules must allow clinical read, clinical write, content-type whitelist, and size limit below `15 MB`.

- [ ] **Step 4: Run tests and commit.**

  ```bash
  npx vitest run src/tests/features/clinical-documents/clinicalAttachmentFilePolicy.test.ts src/tests/features/clinical-documents/clinicalAttachmentPathController.test.ts src/tests/features/clinical-documents/clinicalAttachmentRuntimeContracts.test.ts src/tests/security/rulesHardeningStatic.test.ts
  git add src/features/clinical-documents/domain/clinicalAttachmentTypes.ts src/features/clinical-documents/contracts/clinicalAttachmentRuntimeContracts.ts src/features/clinical-documents/controllers/clinicalAttachmentFilePolicy.ts src/features/clinical-documents/controllers/clinicalAttachmentPathController.ts src/features/clinical-documents/domain/entities.ts storage.rules src/tests/features/clinical-documents/clinicalAttachmentFilePolicy.test.ts src/tests/features/clinical-documents/clinicalAttachmentPathController.test.ts src/tests/features/clinical-documents/clinicalAttachmentRuntimeContracts.test.ts src/tests/security/rulesHardeningStatic.test.ts
  git commit -m "feat: add clinical attachment contracts"
  ```

### Task 2: Storage Runtime, Repository, and Use Cases

**Files:**

- Create: `src/services/firebase-runtime/clinicalAttachmentRuntime.ts`
- Create: `src/services/repositories/ClinicalAttachmentRepository.ts`
- Create: `src/application/clinical-documents/clinicalAttachmentUseCases.ts`
- Test: `src/tests/services/repositories/ClinicalAttachmentRepository.test.ts`
- Test: `src/tests/application/clinical-documents/clinicalAttachmentUseCases.test.ts`

- [ ] **Step 1: Write failing tests for upload/list/delete and compensation on metadata failure.**

  Expected behaviors:
  - successful upload writes Storage then Firestore metadata;
  - Storage failure creates no metadata;
  - metadata failure tries to delete the uploaded Storage object;
  - list by episode filters active records;
  - list by patient groups all active records for the RUT;
  - delete marks metadata as deleted and attempts Storage delete.

- [ ] **Step 2: Implement runtime and repository.**

  Runtime wraps `ref`, `uploadBytes`, `getDownloadURL`, and `deleteObject`.

- [ ] **Step 3: Implement use cases with `ApplicationOutcome`.**

  Use cases return `success` or `failed` with user-safe messages and never leak raw Firebase errors to the UI.

- [ ] **Step 4: Run tests and commit.**

  ```bash
  npx vitest run src/tests/services/repositories/ClinicalAttachmentRepository.test.ts src/tests/application/clinical-documents/clinicalAttachmentUseCases.test.ts
  git add src/services/firebase-runtime/clinicalAttachmentRuntime.ts src/services/repositories/ClinicalAttachmentRepository.ts src/application/clinical-documents/clinicalAttachmentUseCases.ts src/tests/services/repositories/ClinicalAttachmentRepository.test.ts src/tests/application/clinical-documents/clinicalAttachmentUseCases.test.ts
  git commit -m "feat: persist clinical attachments"
  ```

### Task 3: Workspace Panel by Episode

**Files:**

- Create: `src/features/clinical-documents/hooks/useClinicalAttachments.ts`
- Create: `src/features/clinical-documents/components/ClinicalAttachmentsPanel.tsx`
- Modify: `src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts`
- Modify: `src/features/clinical-documents/components/ClinicalDocumentSheet.tsx`
- Modify: `src/features/clinical-documents/components/clinicalDocumentSheetShared.ts`
- Test: `src/tests/features/clinical-documents/ClinicalAttachmentsPanel.test.tsx`
- Test: `src/tests/features/clinical-documents/useClinicalAttachments.test.tsx`

- [ ] **Step 1: Write failing UI/hook tests for listing and upload.**

  Tests cover image/PDF/DOCX selection, visible upload status, active list rendering, and error notice on rejection.

- [ ] **Step 2: Implement hook and panel.**

  Panel shows a compact "Archivos del episodio" section for the current episode with `Adjuntar`, type icons, file name, size, created date, open/delete actions, and explicit scope labels.

- [ ] **Step 3: Wire panel into `ClinicalDocumentSheet`.**

  The sheet receives `attachments`, `onUploadAttachment`, `onDeleteAttachment`, and `isUploadingAttachment`.

- [ ] **Step 4: Run focused tests and commit.**

  ```bash
  npx vitest run src/tests/features/clinical-documents/ClinicalAttachmentsPanel.test.tsx src/tests/features/clinical-documents/useClinicalAttachments.test.tsx src/tests/features/clinical-documents/ClinicalDocumentSheet.test.tsx
  git add src/features/clinical-documents/hooks/useClinicalAttachments.ts src/features/clinical-documents/components/ClinicalAttachmentsPanel.tsx src/features/clinical-documents/hooks/useClinicalDocumentsWorkspaceModel.ts src/features/clinical-documents/components/ClinicalDocumentSheet.tsx src/features/clinical-documents/components/clinicalDocumentSheetShared.ts src/tests/features/clinical-documents/ClinicalAttachmentsPanel.test.tsx src/tests/features/clinical-documents/useClinicalAttachments.test.tsx
  git commit -m "feat: show clinical attachments in document workspace"
  ```

### Task 4: Image Compression and Paste Integration

**Files:**

- Create: `src/features/clinical-documents/controllers/clinicalAttachmentImageCompressionController.ts`
- Modify: `src/features/clinical-documents/controllers/clinicalDocumentPasteController.ts`
- Modify: `src/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController.ts`
- Modify: `src/features/clinical-documents/components/ClinicalDocumentRichTextEditor.tsx`
- Modify: `src/features/clinical-documents/components/ClinicalDocumentSheet.tsx`
- Test: `src/tests/features/clinical-documents/clinicalAttachmentImageCompressionController.test.ts`
- Test: `src/tests/features/clinical-documents/clinicalDocumentPasteController.test.ts`
- Test: `src/tests/features/clinical-documents/useClinicalDocumentRichTextEditorController.test.ts`

- [ ] **Step 1: Write failing tests for paste lanes and compression.**

  Tests cover inline image up to `500 KB`, Storage image over `500 KB`, compressible image over `2 MB`, and rejection over `10 MB`.

- [ ] **Step 2: Implement compression controller.**

  Use canvas-based compression with injectable browser primitives for tests.

- [ ] **Step 3: Wire paste upload callback.**

  Editor calls `onUploadPastedImage(file)` for Storage lane. On success it inserts `<img src="downloadUrl" data-clinical-attachment-id="...">`.

- [ ] **Step 4: Run tests and commit.**

  ```bash
  npx vitest run src/tests/features/clinical-documents/clinicalAttachmentImageCompressionController.test.ts src/tests/features/clinical-documents/clinicalDocumentPasteController.test.ts src/tests/features/clinical-documents/useClinicalDocumentRichTextEditorController.test.ts
  git add src/features/clinical-documents/controllers/clinicalAttachmentImageCompressionController.ts src/features/clinical-documents/controllers/clinicalDocumentPasteController.ts src/features/clinical-documents/hooks/useClinicalDocumentRichTextEditorController.ts src/features/clinical-documents/components/ClinicalDocumentRichTextEditor.tsx src/features/clinical-documents/components/ClinicalDocumentSheet.tsx src/tests/features/clinical-documents/clinicalAttachmentImageCompressionController.test.ts src/tests/features/clinical-documents/clinicalDocumentPasteController.test.ts src/tests/features/clinical-documents/useClinicalDocumentRichTextEditorController.test.ts
  git commit -m "feat: store pasted clinical images as attachments"
  ```

### Task 5: Final Validation

- [ ] **Step 1: Run feature and repo gates.**

  ```bash
  npm run test:clinical-documents
  npm run typecheck
  npm run lint -- --max-warnings 0
  npm run build
  npm run check:clinical-documents-feature-boundary
  npm run check:application-port-boundary
  git diff --check
  ```

- [ ] **Step 2: Manual localhost validation.**

  Run app on `http://127.0.0.1:3020/`, open a patient document, upload PDF/DOCX/image, paste a medium image, confirm Storage-backed image appears and the document autosaves without base64.

- [ ] **Step 3: Commit any final fixes.**

  ```bash
  git status --short
  git commit -m "test: validate clinical attachments workflow"
  ```
