# Deuda Estructural Sin Funciones Nuevas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce structural debt, operational noise, and maintenance risk without adding user-facing features.

**Architecture:** Keep each block narrow, behavior-preserving, and guarded by tests. Prefer extracting existing responsibilities into focused helpers/controllers over changing product flows. Each block must leave `main`-compatible guardrails green before the next block starts.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Firebase/Firestore emulator, Playwright gates, existing HHR quality scripts.

---

### Task 1: Shared Operational Test Noise Filter

**Files:**

- Create: `src/tests/utils/operationalConsoleNoiseFilter.ts`
- Modify: `src/tests/setup.ts`
- Modify: `src/tests/emulator-ui/setup.ts`
- Modify: `src/tests/build/testSetupConsoleNoiseFilter.test.ts`

- [x] **Step 1: Write the failing governance test**

```ts
it('shares the operational-noise filter with unit and emulator UI setup', () => {
  const root = process.cwd();
  const unitSetup = fs.readFileSync(path.join(root, 'src/tests/setup.ts'), 'utf8');
  const emulatorSetup = fs.readFileSync(path.join(root, 'src/tests/emulator-ui/setup.ts'), 'utf8');
  const sharedFilter = fs.readFileSync(
    path.join(root, 'src/tests/utils/operationalConsoleNoiseFilter.ts'),
    'utf8'
  );

  expect(sharedFilter).toContain('export const ALLOWED_OPERATIONAL_CONSOLE_NOISE_PATTERNS');
  expect(sharedFilter).toContain('export const shouldFilterOperationalConsoleMessage');
  expect(sharedFilter).toContain('export const wrapConsoleForOperationalNoise');
  expect(unitSetup).toContain(
    "wrapConsoleForOperationalNoise(['log', 'warn', 'error', 'info', 'debug'])"
  );
  expect(emulatorSetup).toContain("wrapConsoleForOperationalNoise(['warn', 'error'])");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/build/testSetupConsoleNoiseFilter.test.ts`

Expected: FAIL because `src/tests/utils/operationalConsoleNoiseFilter.ts` does not exist and emulator UI setup does not use the shared filter.

- [x] **Step 3: Extract shared filter**

Create `src/tests/utils/operationalConsoleNoiseFilter.ts` with the existing `allowedNoisyConsolePatterns`, `shouldFilterConsoleMessage`, and `wrapConsole` behavior renamed to exported functions.

- [x] **Step 4: Wire setup files**

Replace the inline filter in `src/tests/setup.ts` with:

```ts
import { wrapConsoleForOperationalNoise } from '@/tests/utils/operationalConsoleNoiseFilter';

wrapConsoleForOperationalNoise(['log', 'warn', 'error', 'info', 'debug']);
```

Add to `src/tests/emulator-ui/setup.ts`:

```ts
import { wrapConsoleForOperationalNoise } from '@/tests/utils/operationalConsoleNoiseFilter';

wrapConsoleForOperationalNoise(['warn', 'error']);
```

- [x] **Step 5: Run focused verification**

Run:

```bash
npx vitest run src/tests/build/testSetupConsoleNoiseFilter.test.ts
npx vitest run -c vitest.emulator-ui.config.ts src/tests/emulator-ui/dailyRecordSyncQuery.emulator-ui.test.tsx
```

Expected: both pass. Emulator UI should no longer print the known invariant-repair noise that previously filled stderr.

- [x] **Step 6: Commit**

```bash
git add src/tests/utils/operationalConsoleNoiseFilter.ts src/tests/setup.ts src/tests/emulator-ui/setup.ts src/tests/build/testSetupConsoleNoiseFilter.test.ts docs/superpowers/plans/2026-05-23-deuda-estructural-sin-funciones-nuevas.md
git commit -m "test: share operational console noise filter"
```

### Task 2: Daily Record Write Responsibility Split

**Files:**

- Modify/Create focused helpers under `src/services/repositories/`
- Test: targeted repository/controller tests already covering partial writes and invariant repair.

- [x] Extract retry/recovery decision code from `dailyRecordRepositoryWriteService.ts`.
- [x] Keep public API unchanged.
- [x] Run `npm run test:repository-compat` plus focused write-service tests.
- [x] Commit.

### Task 3: Contract Surface Protection

**Files:**

- Modify existing contract tests under `src/tests/application`, `src/tests/shared`, and `src/tests/features/census`.

- [x] Add/strengthen contract tests around high-inbound contract modules.
- [x] Avoid production changes unless tests reveal an actual contract ambiguity.
- [x] Run focused contract tests and `npm run check:quality`.
- [x] Commit.

### Task 4: Startup Bundle Pressure Reduction

**Files:**

- Modify route/component imports only where heavy modules enter the authenticated shell.
- Test: build/bundle budget and relevant entrypoint tests.

- [x] Identify heavy imports in authenticated shell.
- [x] Move safe heavy imports behind existing lazy boundaries.
- [x] Run `npm run build` and `npm run check:bundle-budget`.
- [x] Commit.

### Task 5: Census/Hook Churn Organization

**Files:**

- Modify only existing census/hook controllers with high churn and clear responsibility leakage.

- [x] Rename/group controller helpers where cohesion is obvious.
- [x] Preserve exports or add compatibility wrappers only when needed.
- [x] Run focused census/hook tests plus `npm run check:census-module-size`.
- [x] Commit.

### Task 6: IndexedDB Runtime Boundary Cleanup

**Files:**

- Modify `src/services/storage/indexeddb/` helpers.
- Test: indexedDB recovery/runtime tests.

- [x] Split open/recovery/health concerns only where current tests expose repeated setup.
- [x] Keep behavior identical.
- [x] Run indexedDB focused tests.
- [x] Commit.

### Task 7: Final Gate

- [x] Run `npm run typecheck`.
- [x] Run `npm run lint -- --max-warnings 0`.
- [x] Run `npm run check:quality`.
- [x] Run `npm run test:ci:unit`.
- [x] Run `npm run build`.
- [x] Run Firestore gates if the branch touched persistence/security.
- [x] Summarize before pushing or opening PR.
