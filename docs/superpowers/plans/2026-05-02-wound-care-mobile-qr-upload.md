# Wound Care Mobile QR Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 60-minute QR access flow so mobile devices can upload clinical audiovisual records to a specific hospitalization episode.

**Architecture:** Reuse the existing wound-care photo upload pipeline and add a small session layer for QR credentials. The public mobile route validates an opaque session id before allowing uploads and never exposes the main app shell.

**Tech Stack:** React, TypeScript, Firestore repository ports, existing wound-care use cases, Firebase Storage upload helpers, Vitest.

---

### Task 1: Session Domain And Use Cases

**Files:**

- Modify: `src/types/domain/woundCare.ts`
- Modify: `src/schemas/zod/woundCare.ts`
- Create: `src/services/repositories/WoundCareMobileUploadSessionRepository.ts`
- Modify: `src/application/ports/woundCarePort.ts`
- Create: `src/application/wound-care/woundCareMobileUploadSessionUseCases.ts`
- Modify: `src/application/wound-care/woundCareUseCases.ts`
- Modify: `src/constants/firestorePaths.ts`
- Test: `src/tests/application/wound-care/woundCareMobileUploadSessionUseCases.test.ts`

- [ ] Add `WoundCareMobileUploadSession` with expiration and revocation fields.
- [ ] Add repository methods `getById`, `create`, and `revoke`.
- [ ] Add use cases to create, validate, revoke, and upload via session.
- [ ] Validate that sessions expire after 60 minutes and preserve `episodeKey`.

### Task 2: Mobile Route And Upload UI

**Files:**

- Create: `src/features/wound-care/components/WoundCareMobileUploadView.tsx`
- Modify: `src/views/LazyViews.ts`
- Modify: `src/App.tsx`
- Test: `src/tests/features/wound-care/WoundCareMobileUploadView.test.tsx`

- [ ] Add public route handling for `/wound-care/mobile-upload/:sessionId`.
- [ ] Render a mobile-first page outside the authenticated shell.
- [ ] Allow upload only when session validation succeeds.
- [ ] Show clear expired/revoked/error states.

### Task 3: QR Panel In Existing Modal

**Files:**

- Create: `src/features/wound-care/components/WoundCareMobileQrPanel.tsx`
- Create: `src/features/wound-care/hooks/useWoundCareMobileUploadSession.ts`
- Modify: `src/features/wound-care/components/WoundCareModal.tsx`
- Modify: `src/features/handoff/components/HandoffPatientCell.tsx`
- Test: `src/tests/features/wound-care/WoundCareModal.test.tsx`

- [ ] Rename visible labels to "Registro clínico audiovisual".
- [ ] Add "Ver QR móvil" to the current editable hospitalization.
- [ ] Generate/revoke sessions from the modal.
- [ ] Render a QR using a lightweight SVG QR component.

### Task 4: Verification

**Commands:**

- `npm run test:ci:unit -- src/tests/application/wound-care/woundCareMobileUploadSessionUseCases.test.ts src/tests/features/wound-care/WoundCareMobileUploadView.test.tsx src/tests/features/wound-care/WoundCareModal.test.tsx`
- `npm run typecheck`
- `npm run lint`
- `npm run check:quality`
- `npm run build`
