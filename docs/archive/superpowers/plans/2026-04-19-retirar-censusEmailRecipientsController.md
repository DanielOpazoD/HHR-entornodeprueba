# Retirar `censusEmailRecipientsController` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** retirar el wrapper de compatibilidad `src/hooks/controllers/censusEmailRecipientsController.ts` sin cambiar comportamiento, migrando primero su cobertura restante a la capa canónica `src/features/census/controllers/censusEmailRecipientsController.ts`.

**Architecture:** la lógica canónica ya vive en `features/census/controllers`. La capa `hooks/controllers` solo debe existir si tiene consumidores reales; en este caso, el wrapper parece quedar como re-export histórico. El plan mueve la cobertura residual a la suite canónica, valida que no queden importadores del wrapper y luego elimina el archivo, dejando el árbol más limpio sin introducir nuevas abstracciones.

**Tech Stack:** TypeScript, Vitest, existing controller test suites, ripgrep for import audit

---

### Task 1: Migrate compatibility coverage into the canonical census controller test

**Files:**

- Modify: `src/tests/views/census/censusEmailRecipientsController.test.ts`
- Delete: `src/tests/hooks/censusEmailRecipientsController.test.ts`

- [ ] **Step 1: Add the wrapper-only assertions to the canonical feature test**

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  resolveAddRecipient,
  resolveBulkRecipients,
  resolveLegacyRecipients,
  resolveRemoveRecipient,
  resolveSafeRecipients,
  resolveSendingRecipients,
  resolveStoredRecipients,
  resolveUpdateRecipient,
  resolveVisibleRecipients,
} from '@/features/census/controllers/censusEmailRecipientsController';

describe('censusEmailRecipientsController', () => {
  it('resolves stored recipients and legacy payloads safely', () => {
    expect(resolveStoredRecipients(['a@test.com'])).toEqual(['a@test.com']);
    expect(resolveStoredRecipients([])).toBeNull();
    expect(resolveStoredRecipients(null)).toBeNull();

    expect(resolveLegacyRecipients('["legacy@test.com"]')).toEqual(['legacy@test.com']);
    expect(resolveLegacyRecipients('{bad json}')).toBeNull();
  });

  it('validates test mode recipients and normalizes sending recipients', () => {
    const invalidTestMode = resolveSendingRecipients({
      recipients: ['a@test.com'],
      shouldUseTestMode: true,
      testRecipient: 'bad-email',
    });
    expect(invalidTestMode.ok).toBe(false);

    const normalMode = resolveSendingRecipients({
      recipients: [' A@TEST.COM ', ''],
      shouldUseTestMode: false,
      testRecipient: '',
    });
    expect(normalMode).toEqual({ ok: true, recipients: ['a@test.com'] });
  });
});
```

- [ ] **Step 2: Run the focused test file and confirm the canonical suite covers the old wrapper behavior**

Run: `npx vitest run src/tests/views/census/censusEmailRecipientsController.test.ts`

Expected: PASS with the legacy/storage/sending assertions covered by the canonical feature suite.

- [ ] **Step 3: Delete the now-duplicated hook-layer test**

Run: `rm src/tests/hooks/censusEmailRecipientsController.test.ts`

Expected: the hook-layer test file no longer exists, because its assertions now live in the canonical suite.

### Task 2: Remove the compatibility wrapper after import audit

**Files:**

- Modify: `src/hooks/controllers/README.md`
- Delete: `src/hooks/controllers/censusEmailRecipientsController.ts`

- [ ] **Step 1: Audit every remaining importer of the hook wrapper**

Run: `rg -n "@/hooks/controllers/censusEmailRecipientsController|censusEmailRecipientsController" src`

Expected: only the canonical feature controller path remains, or no runtime importers remain at all.

- [ ] **Step 2: Update the hooks/controllers README if it still lists the wrapper as a live controller**

Keep the table aligned with the actual source of truth. If the wrapper is gone, remove that row or point the entry at `src/features/census/controllers/censusEmailRecipientsController.ts` instead of the hook-layer path.

- [ ] **Step 3: Delete the hook-layer re-export**

Run: `rm src/hooks/controllers/censusEmailRecipientsController.ts`

Expected: the compatibility wrapper disappears entirely once no runtime or test importers depend on it.

- [ ] **Step 4: Verify the repo still agrees on the canonical controller**

Run:
`npm run typecheck`
`npm run check:quality`

Expected: both commands pass with no new boundary or import drift.

### Task 3: Final sanity check and cleanup gate

**Files:**

- No new files; verification only

- [ ] **Step 1: Confirm the wrapper path no longer exists anywhere in the tracked source**

Run: `rg -n "@/hooks/controllers/censusEmailRecipientsController|src/hooks/controllers/censusEmailRecipientsController.ts" src`

Expected: no remaining tracked import or source reference to the deleted wrapper.

- [ ] **Step 2: Confirm the canonical feature controller remains the only implementation**

Run: `sed -n '1,220p' src/features/census/controllers/censusEmailRecipientsController.ts`

Expected: the canonical controller still contains all behavior for normalize/sanitize/add/bulk/update/remove/visible/sending logic.

- [ ] **Step 3: Commit only after the import audit and verification are green**

Run: `git add src/tests/views/census/censusEmailRecipientsController.test.ts src/hooks/controllers/README.md src/hooks/controllers/censusEmailRecipientsController.ts src/tests/hooks/censusEmailRecipientsController.test.ts && git commit -m "refactor: retire census email recipients wrapper"`

Expected: one small commit that removes the compatibility seam after its coverage has been migrated.

**Self-check**

- Spec coverage: the plan covers migrating the only wrapper-only assertions, deleting the duplicate hook-layer test, removing the wrapper, and verifying no consumers remain.
- Placeholder scan: no TBD or generic filler steps; every destructive step names the exact file and follow-up check.
- Type consistency: test names, import paths, and file paths all point at the same canonical feature controller.
