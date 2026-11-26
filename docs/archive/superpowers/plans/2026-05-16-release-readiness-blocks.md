# Release Readiness Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five release-readiness blocks with small verified commits: fresh evidence, clinical sync safety, operational UX, security/rules hardening, and final release validation.

**Architecture:** Work stays on `codex/release-readiness-blocks`. Each block must end with a focused commit and a concrete verification set. Avoid broad rewrites; use existing report, guardrail, Playwright, repository, and observability patterns.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Playwright, Firebase/Firestore rules, Netlify/Firebase functions, repo scripts in `package.json`.

---

### Task 1: Fresh Release Evidence Pack

**Files:**

- Modify generated reports under `reports/`
- Test: existing report freshness and release evidence scripts

- [x] **Step 1: Regenerate release evidence reports**

Run:

```bash
npm run report:quality-metrics
npm run report:system-confidence
npm run report:operational-health
npm run report:release-confidence-matrix
npm run report:release-readiness-scorecard
npm run report:maintenance-debt-scorecard
```

Expected: each command exits `0` and report commits match current `HEAD`.

- [x] **Step 2: Verify strict freshness and release evidence**

Run:

```bash
npm run check:report-freshness:strict
npm run check:release-evidence
npm run check:quality
```

Expected: all commands exit `0`.

- [x] **Step 3: Commit**

```bash
git add reports
git commit -m "chore(release): refresh evidence pack"
```

Evidence captured on 2026-05-16:

- `npm run report:release-readiness-scorecard` completed and regenerated critical coverage with 1235 passed test files, 6766 passed tests, 128 skipped, 6 todo.
- `npm run check:report-freshness:strict` passed: reports match `a2b2a434` or a direct merge parent, worktree clean.
- `npm run check:release-evidence` passed: fresh reports from a clean checkout.
- `npm run check:quality` passed during the block before the checkpoint commit.

### Task 2: Clinical Sync And Persistence Shield

**Files:**

- Inspect/modify likely seams: `src/services/repositories/dailyRecordRepositoryWriteService*.ts`, `src/services/repositories/dailyRecordPendingPatchController.ts`, `src/hooks/useDailyRecordQuery.ts`, `src/services/storage/**`
- Add or extend tests in `src/tests/services/repositories/` or `src/tests/hooks/controllers/`

- [x] **Step 1: Identify one current high-risk sync path**

Run:

```bash
rg -n "pending|stale|writeAccepted|conflict|autoMerge|patch" src/services/repositories src/hooks src/tests/services/repositories src/tests/hooks/controllers
```

Expected: select one concrete clinical persistence path, not a broad rewrite.

- [x] **Step 2: Add focused regression coverage**

Add a test that proves the selected path preserves the local clinical change across stale remote hydration, failed write, or retry state.

- [x] **Step 3: Implement only the minimal code needed**

Keep the change inside the selected controller/repository seam.

- [x] **Step 4: Verify**

Run the focused test, then:

```bash
npm run check:quality
npm run test:repository-compat
```

Expected: all commands exit `0`.

- [x] **Step 5: Commit**

```bash
git add src
git commit -m "fix(sync): protect clinical census persistence"
```

Evidence captured on 2026-05-16:

- Selected risk: pending census patches registered for an older bed episode were not purged when realtime moved the bed to a different episode, leaving a path for stale clinical status to reappear on later snapshots.
- Code closure: `src/hooks/controllers/dailyRecordPendingPatchController.ts` now removes tracked pending census paths when the incoming and previous bed episodes no longer match, and deletes the pending entry when nothing valid remains.
- Regression closure: `src/tests/hooks/controllers/dailyRecordPendingStatusEpisodeHydration.test.ts` covers the two-snapshot reuse case where an old `GRAVE` status must not override a new `ESTABLE` episode.
- Verification: `npm exec -- vitest run src/tests/hooks/controllers/dailyRecordPendingStatusEpisodeHydration.test.ts src/tests/hooks/controllers/dailyRecordPendingPatchController.test.ts src/tests/hooks/controllers/dailyRecordQueryController.test.ts` passed 16 tests.
- Verification: `npm run typecheck`, `npm run check:quality`, and `npm run test:repository-compat` passed.
- Broader accidental verification: `npm test -- --run ...` executed the repo wrapper and passed unit tests, Firestore rules, sync emulator, and emulator UI suites.
- Additional risk matrix closure:
  - Same bed + same episode: keep the pending clinical patch until remote confirms it, then release it.
  - Same bed + different episode: purge tracked clinical census fields so stale status, pathology, or specialty cannot cross patient episodes.
  - Same episode + different bed: treat it as a bed move; apply the pending clinical patch to the moved bed while preserving the original source-bed path as the episode anchor until remote confirms it.
  - Mixed clinical/non-clinical patch: purge or release only tracked census fields (`pathology`, `specialty`, `secondarySpecialty`, `status`) and leave unrelated patch data untouched.
- Additional code closure: `src/hooks/controllers/dailyRecordPendingPatchController.ts` now resolves same-episode bed moves before applying or releasing tracked pending census fields.
- Additional regression closure: `src/tests/hooks/controllers/dailyRecordPendingPatchController.test.ts` covers same-episode bed transfer from `R1` to `R2` without reapplying the patch to the emptied source bed.
- Additional verification: `npm exec -- vitest run src/tests/hooks/controllers/dailyRecordPendingPatchController.test.ts src/tests/hooks/controllers/dailyRecordPendingStatusEpisodeHydration.test.ts src/tests/hooks/controllers/dailyRecordQueryController.test.ts` passed 17 tests.

### Task 3: Operational UX For Degraded States

**Files:**

- Inspect/modify likely seams: `src/services/observability/`, `src/app-shell/`, `src/features/census/`, `src/features/clinical-documents/`
- Add or extend tests in `src/tests/features/`, `src/tests/app-shell/`, or `src/tests/services/observability/`

- [x] **Step 1: Choose one silent or ambiguous state**

Use current runtime contracts and tests to pick one user-visible ambiguity, such as sync retrying, permission denial, stale document state, or unavailable telemetry.

- [x] **Step 2: Add UI/regression coverage**

Add a focused test proving the state is visible and actionable, without adding a new parallel workflow.

- [x] **Step 3: Implement the smallest visible status improvement**

Use existing status/banner/presentation patterns.

- [x] **Step 4: Verify**

Run the focused test, then:

```bash
npm run lint
npm run check:quality
PLAYWRIGHT_WEB_SERVER_PORT=4174 npm run test:e2e:clinical-visual-release
```

Expected: all commands exit `0`.

- [x] **Step 5: Commit**

```bash
git add src e2e reports/e2e
git commit -m "feat(ops): surface clinical degraded states"
```

Evidence captured on 2026-05-16:

- Selected ambiguity: the census operational controller still distinguishes local cache, remote reconciliation, loading, and pending empty-day verification, but those transitional states must not look like blocking clinical alarms.
- Code closure: `src/features/census/controllers/censusOperationalStateController.ts` keeps those non-settled states available for flow control while suppressing their visible banner presentation.
- Regression closure: `src/tests/views/census/censusOperationalStateController.test.ts`, `src/tests/views/census/CensusRegisterContent.test.tsx`, `src/tests/views/census/CensusView.test.tsx`, and `src/tests/app-shell/BootstrapRouteChrome.test.tsx` assert that non-critical operational states do not add a visible banner or false blocking load state.
- Verification: `npm exec -- vitest run src/tests/views/census/censusOperationalStateController.test.ts src/tests/views/census/CensusRegisterContent.test.tsx src/tests/views/census/CensusView.test.tsx src/tests/app-shell/BootstrapRouteChrome.test.tsx` passed 19 tests.

### Task 4: Security, Rules, And Dependency Risk Closure

**Files:**

- Inspect/modify likely seams: `package-lock.json`, `functions/package-lock.json`, `rules/firestore/*.rules`, `firestore.rules`, `scripts/check-dependency-vulnerabilities.mjs`
- Add or extend tests in `src/tests/security/` or `src/tests/build/`

- [x] **Step 1: Re-run current dependency and rules gates**

Run:

```bash
npm run check:dependency-vulnerabilities
npm run check:security
npm run test:firestore:release:ci
```

Expected: identify whether remaining dependency risk is policy-accepted moderate debt or an actionable safe patch.

- [x] **Step 2: Apply only safe dependency/rules changes**

Do not perform major Firebase/admin upgrades unless the command output proves they are required for high/critical closure.

- [x] **Step 3: Verify**

Run:

```bash
npm run check:dependency-vulnerabilities
npm run check:security
npm run test:firestore:release:ci
```

Expected: all commands exit `0`.

- [x] **Step 4: Commit**

```bash
git add package-lock.json functions/package-lock.json rules firestore.rules reports/security
git commit -m "chore(security): close release security gates"
```

Evidence captured on 2026-05-16:

- Security/dependency closure: `npm run check:dependency-vulnerabilities` passed and regenerated `reports/security/dependency-audit.json` without tracked changes.
- Rules/security closure: `npm run check:security` passed, including secret leak checks, generated rules sync, rules source governance, Firestore rules governance, critical access matrix, and security hardening.
- Release gate finding: first `npm run test:firestore:release:ci` run exposed a performance-budget false signal after the Bloque 3 banner change: `waitForCensoReady` counted the informational operational banner as census readiness, then `ensureRecordExists` waited for `networkidle`.
- Code closure: `e2e/startup-performance-budget.spec.ts` now treats the banner as operational context, not as the clinical surface ready signal, and still validates that any visible post-ready banner is non-blocking.
- Verification: direct `PLAYWRIGHT_USE_PREVIEW=1 PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 npm run test:e2e:flow-performance:built` passed.
- Verification: repeated `npm run test:firestore:release:ci` passed fully: build, Firestore rules, sync emulator, emulator UI, critical E2E, built performance E2E, and flow budget report.

### Task 5: Final Release Gate And Visual Closure

**Files:**

- Modify generated reports under `reports/`
- Modify docs only if release closure evidence needs an explicit note

- [ ] **Step 1: Run merge and release gates**

Run:

```bash
npm run ci:merge-gate
npm run ci:release-gate
```

Expected: both commands exit `0`.

- [ ] **Step 2: Confirm final visual/manual evidence**

Run:

```bash
PLAYWRIGHT_WEB_SERVER_PORT=4174 npm run test:e2e:clinical-visual-release
```

Expected: Playwright exits `0` and attaches current clinical surfaces.

- [ ] **Step 3: Refresh final reports after any generated evidence changes**

Run:

```bash
npm run check:release-evidence
git status --short
```

Expected: release evidence exits `0`; changed report files are reviewed.

- [ ] **Step 4: Commit**

```bash
git add reports docs
git commit -m "chore(release): close final release gate"
```
