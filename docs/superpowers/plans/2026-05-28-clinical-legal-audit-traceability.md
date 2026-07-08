# Clinical Legal Audit Traceability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clinical/legal audit presentation layer and update the audit UI so logs read as clinical traceability, not implementation telemetry.

**Architecture:** Keep the existing `AuditLogEntry` persistence contract intact. Add a pure controller that maps each log to a `ClinicalAuditPresentation`, then consume that in row rendering and worker search. UI changes stay inside the admin audit components and avoid storage/schema migration.

**Tech Stack:** React, TypeScript, Vitest, existing audit worker/filter infrastructure, Tailwind classes already used by the admin UI.

---

## File Map

- Create `src/services/admin/clinicalAuditPresentation.ts`: pure translation/classification layer for audit logs.
- Create `src/tests/services/admin/clinicalAuditPresentation.test.ts`: unit coverage for clinical narratives, IP/actor fallbacks, unknown actions, and important changes.
- Modify `src/services/admin/auditWorkerLogic.ts`: search through IP, UID, summary, entity id, action labels, and clinical presentation text.
- Modify `src/tests/services/admin/auditWorkerLogic.test.ts`: focused search coverage.
- Modify `src/features/admin/components/internal/audit/AuditLogRow.tsx`: render clinical/legal presentation and separate technical detail from clinical detail.
- Modify `src/features/admin/components/internal/audit/AuditTable.tsx`: change headings to clinical/legal language.
- Modify `src/features/admin/components/internal/audit/AuditFilters.tsx`: update search wording.
- Modify `src/tests/views/admin/components/audit/AuditStatsDashboard.test.tsx` only if existing snapshots/queries require label adjustment.
- Modify or create row component tests if current coverage is insufficient.

## Task 1: Clinical Presentation Controller

**Files:**

- Create: `src/services/admin/clinicalAuditPresentation.ts`
- Test: `src/tests/services/admin/clinicalAuditPresentation.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests covering:

```ts
import { describe, expect, it } from 'vitest';
import { buildClinicalAuditPresentation } from '@/services/admin/clinicalAuditPresentation';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  timestamp: '2026-05-28T12:34:56.000Z',
  userId: 'dra.riviere@hospital.cl',
  userDisplayName: 'Dra. Riviere',
  userUid: 'uid-123',
  ipAddress: '190.10.10.10',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'Cama 4',
  details: {},
  ...overrides,
});

describe('buildClinicalAuditPresentation', () => {
  it('renders patient movement as clinical traceability', () => {
    const presentation = buildClinicalAuditPresentation(
      baseLog({
        details: {
          movementKind: 'move',
          patientName: 'Juan Perez',
          sourceBed: '4',
          targetBed: '6',
        },
      })
    );

    expect(presentation.title).toBe('Paciente trasladado de cama');
    expect(presentation.narrative).toContain('Juan Perez');
    expect(presentation.narrative).toContain('cama 4');
    expect(presentation.narrative).toContain('cama 6');
    expect(presentation.originLabel).toBe('IP 190.10.10.10');
    expect(presentation.actorLabel).toBe('Dra. Riviere');
  });

  it('makes missing IP and actor explicit', () => {
    const presentation = buildClinicalAuditPresentation(
      baseLog({
        userId: '',
        userDisplayName: undefined,
        userUid: undefined,
        ipAddress: undefined,
        action: 'USER_LOGIN',
        entityType: 'user',
        entityId: 'unknown',
        details: { event: 'login' },
      })
    );

    expect(presentation.actorLabel).toBe('Usuario no identificado');
    expect(presentation.originLabel).toBe('IP no disponible');
  });

  it('does not expose raw JSON for unknown default narratives', () => {
    const presentation = buildClinicalAuditPresentation(
      baseLog({
        action: 'SYSTEM_ERROR',
        entityType: 'system',
        entityId: 'err-1',
        details: { codeName: 'internal_debug_key', nested: { raw: true } },
      })
    );

    expect(presentation.narrative).not.toContain('{');
    expect(presentation.narrative).not.toContain('internal_debug_key');
    expect(presentation.technical.action).toBe('SYSTEM_ERROR');
  });

  it('translates known changed fields to clinical labels', () => {
    const presentation = buildClinicalAuditPresentation(
      baseLog({
        details: {
          patientName: 'Ana Vera',
          changes: {
            note: { old: 'estable', new: 'dolor toracico' },
            specialty: { old: 'Medicina', new: 'Cirugia' },
          },
        },
      })
    );

    expect(presentation.importantChanges).toEqual([
      { fieldLabel: 'Nota clínica', oldValue: 'estable', newValue: 'dolor toracico' },
      { fieldLabel: 'Especialidad', oldValue: 'Medicina', newValue: 'Cirugia' },
    ]);
  });
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run src/tests/services/admin/clinicalAuditPresentation.test.ts`

Expected: fail because `clinicalAuditPresentation` does not exist.

- [ ] **Step 3: Implement minimal controller**

Implement `ClinicalAuditPresentation`, `buildClinicalAuditPresentation`, field-label translation, action classification, actor/IP fallback, and safe default narratives.

- [ ] **Step 4: Verify green**

Run: `npx vitest run src/tests/services/admin/clinicalAuditPresentation.test.ts`

Expected: pass.

## Task 2: Search Legal Traceability Fields

**Files:**

- Modify: `src/services/admin/auditWorkerLogic.ts`
- Modify: `src/tests/services/admin/auditWorkerLogic.test.ts`

- [ ] **Step 1: Write failing tests**

Add coverage that `filterLogs` matches:

```ts
expect(filterLogs([log], paramsWithSearch('190.10.10.10'))).toHaveLength(1);
expect(filterLogs([log], paramsWithSearch('uid-123'))).toHaveLength(1);
expect(filterLogs([log], paramsWithSearch('traslado'))).toHaveLength(1);
expect(filterLogs([log], paramsWithSearch('Cama 4'))).toHaveLength(1);
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run src/tests/services/admin/auditWorkerLogic.test.ts`

Expected: at least IP/UID/action-label cases fail if not currently indexed.

- [ ] **Step 3: Implement search expansion**

Use `buildClinicalAuditPresentation(log)` inside worker-safe logic only if it has no browser dependencies. Include presentation title, narrative, affected subject, actor labels, origin, action label, entity id, user uid, user id, display name, patient identifier, raw RUT, and summary in searchable text.

- [ ] **Step 4: Verify green**

Run: `npx vitest run src/tests/services/admin/auditWorkerLogic.test.ts`

Expected: pass.

## Task 3: Audit Row Clinical UI

**Files:**

- Modify: `src/features/admin/components/internal/audit/AuditLogRow.tsx`
- Modify/Create: focused component test for audit row rendering.

- [ ] **Step 1: Write failing component test**

Assert that a patient movement row displays clinical title, responsible user, IP, and does not display `PATIENT_MODIFIED` in the normal row.

- [ ] **Step 2: Verify red**

Run the focused row/audit view test.

- [ ] **Step 3: Implement row UI**

Derive `presentation` once per row. Replace normal summary text with `presentation.title` plus `presentation.narrative`. Show `presentation.originLabel`. In expanded state, render clinical summary, responsible, origin, important changes, and a technical advanced block.

- [ ] **Step 4: Verify green**

Run the focused row/audit view test.

## Task 4: Table And Filter Language

**Files:**

- Modify: `src/features/admin/components/internal/audit/AuditTable.tsx`
- Modify: `src/features/admin/components/internal/audit/AuditFilters.tsx`

- [ ] **Step 1: Update clinical/legal labels**

Use:

- `Momento`
- `Responsable`
- `Evento clínico`
- `Afectado`
- `Origen`
- search placeholder `Paciente, RUT, usuario, UID, IP, acción o registro...`

- [ ] **Step 2: Run focused UI tests**

Run audit component tests affected by text queries.

## Task 5: Verification

**Files:** no production edits unless failures require fixes.

- [ ] **Step 1: Focused tests**

Run:

```bash
npx vitest run src/tests/services/admin/clinicalAuditPresentation.test.ts src/tests/services/admin/auditWorkerLogic.test.ts
```

- [ ] **Step 2: Broader audit tests**

Run:

```bash
npx vitest run src/tests/features/admin/AuditView.test.tsx src/tests/hooks/useAuditData.test.ts src/tests/services/admin/auditWorkerLogic.test.ts
```

- [ ] **Step 3: Required gates**

Run:

```bash
npm run typecheck
npm run lint -- --max-warnings 0
npm run check:quality
```

- [ ] **Step 4: Commit and PR readiness**

Commit coherent changes after tests pass. Push branch and open a PR only after required gates pass.
