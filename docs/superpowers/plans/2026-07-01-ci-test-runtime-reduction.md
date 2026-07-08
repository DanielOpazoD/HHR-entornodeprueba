# CI Test Runtime Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce pull request CI wall time from roughly 31-35 minutes to 17-20 minutes first, then 12-15 minutes if sharding remains stable, while preserving the same release-blocking quality bar.

**Architecture:** Keep the current test pyramid intact, but remove artificial serialization and duplicated execution. Preserve full unit coverage through Vitest sharding, keep emulator and E2E gates blocking, and add a small governance contract that proves critical risk packs are still represented in the full suite when duplicate risk re-runs are removed.

**Tech Stack:** GitHub Actions, npm scripts, Vitest 4, Playwright, Firebase emulator, Node.js scripts.

---

## Current Evidence

- Recent completed `main` workflow `28485560000` took 31m11s wall time.
- Job durations from that run:
  - `quality-static`: 912s / 15m12s
  - `unit-risk`: 659s / 10m59s
  - `e2e-critical`: 307s / 5m07s
  - `build-budget`: 127s / 2m07s
  - `lighthouse-ci`: 167s / 2m47s
  - `rules-emulator`: 77s / 1m17s
  - `API Documentation`: 71s / 1m11s
- The repo currently has about 1358 Vitest test files and 48 Playwright specs.
- The current workflow gates `unit-risk`, `rules-emulator`, and `e2e-critical` behind `quality-static`. That makes the slowest static job block the slowest test job, even though they are independent.
- `unit-risk` runs the full unit/integration suite and then re-runs named risk packs that are already included in the full Vitest include set.
- `e2e-critical` currently runs a build before E2E because `test:e2e:flow-performance:built` needs `dist/`. That can be moved to the build job, which already produces `dist/`.
- `build-budget` runs bundle and chunk checks directly, then calls `ci:preview-gate`, which runs the same bundle and chunk checks again.

## Follow-up PR 139: Quality Static Decomposition

**Goal:** Reduce the remaining `quality-static` bottleneck without lowering the static quality bar or changing the protected aggregate check name.

**Design:**

- Keep the release-blocking check contract as `quality-static`.
- Split the internal static aggregate into six governed groups:
  - `boundaries`: architecture, feature, storage, runtime, legacy bridge, localStorage, and module dependency boundaries.
  - `governance`: generated governance inputs plus schema, runtime contracts, serverless governance, docs drift, runbooks, and guardrail governance.
  - `security`: secret/rules/security checks plus explicit-any and repo hygiene policies.
  - `size`: module-size, hotspot, bundle-risk, and growth budgets.
  - `tests`: trivial-test, governance, failure catalog, and flaky quarantine checks.
  - `reports`: advisory report freshness only.
- Run groups in a GitHub Actions matrix as `quality-static-${group}` after a shared `quality-static-base` job.
- Preserve a final aggregate `quality-static` job that depends on the base job and every group job, so branch protection keeps watching the same stable status.
- Generate `reports/ci-quality-static-profile.json` for full local runs and `reports/ci-quality-static-profile-${group}.json/.md` for grouped runs.
- Keep stale report evidence advisory in the local/static loop, while `quality-static-base` continues to regenerate governance snapshots and enforce `check:report-freshness:strict`.
- Pass regenerated `reports/**` from `quality-static-base` to the `governance` matrix lane as an artifact, because `check:operational-runbooks` and `check:guardrail-governance` intentionally validate generated governance evidence without rerunning the expensive snapshot pack.

**Expected impact:**

- The previous 15m `quality-static` job becomes:
  - one base lane for lint, typecheck, governance snapshot generation, and strict freshness,
  - six parallel static lanes for the existing guardrails.
- Wall-clock improvement depends on the slowest group, but the change removes the artificial serialization across unrelated static checks.
- The generated profile artifacts give the next PR exact data for moving or trimming the new slowest group instead of guessing.

**Evidence commands:**

```bash
npm run check:quality:group -- reports
npm run check:quality:group -- tests
npx vitest run src/tests/build/qualityAggregateSupport.test.ts src/tests/build/ciWorkflowGovernance.test.ts src/tests/scripts/postMergeEvidence.test.ts
```

**Post-merge evidence freshness:**

- `npm run postmerge:evidence` remains the command that regenerates the formal post-merge evidence bundle.
- `npm run check:postmerge-evidence` is advisory and detects whether `reports/postmerge-evidence.json` is stale, incomplete, or records a failed evidence block.
- `npm run check:postmerge-evidence:strict` is available for explicit release verification, but it is not added as a new PR-blocking gate because normal pull requests do not necessarily generate post-merge artifacts.

**Residual risk:**

- CI still pays repeated `npm ci` setup cost for each matrix lane. That is acceptable for this PR because it keeps lanes isolated and avoids shared-state coupling.
- `quality-static-base` still includes `lint`, `typecheck`, snapshot generation, and strict freshness; future optimization should profile that lane before splitting further.
- Advisory report freshness still reports dirty worktree differences locally when reports are stale. That is intentional: it surfaces debt without blocking normal development.

## File Structure

- Modify `.github/workflows/ci-cd.yml`: parallelize independent jobs, add unit sharding, keep stable aggregate check names, and avoid duplicated build/preview checks.
- Modify `package.json`: add explicit scripts for sharded unit runs, risk membership governance, E2E critical without flow performance, and preview smoke without duplicated budget checks.
- Modify `scripts/run-e2e-critical-emulator-ci.sh`: split clinical E2E from built flow performance.
- Create `scripts/config/ci-test-risk-packs.json`: canonical list of critical risk-pack files that must remain covered by the full PR unit suite.
- Create `scripts/check-ci-risk-pack-membership.mjs`: fail CI if a critical risk file is no longer included by `test:ci:unit`.
- Create `scripts/report-ci-runtime-baseline.mjs`: optional local/GitHub helper to print last workflow job durations for PR review evidence.
- Test with `npm run check:ci-risk-pack-membership`, representative Vitest shard commands, `npm run test:e2e:critical:ci`, and full remote CI.

---

### Task 1: Add Risk-Pack Membership Governance

**Files:**

- Create: `scripts/config/ci-test-risk-packs.json`
- Create: `scripts/check-ci-risk-pack-membership.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the risk-pack manifest**

Create `scripts/config/ci-test-risk-packs.json` with every file currently re-run by `test:resilience`, `test:risk:admin-health`, `test:risk:auth`, `test:risk:platform`, and `test:sync-load`.

```json
{
  "version": 1,
  "unitSuiteScript": "test:ci:unit",
  "criticalFiles": [
    "src/tests/integration/sync-resilience.test.ts",
    "src/tests/integration/sync-ui-resilience.test.tsx",
    "src/tests/integration/offline-persistence.test.ts",
    "src/tests/services/admin/healthService.test.ts",
    "src/tests/features/admin/systemHealthStatusPolicy.test.ts",
    "src/tests/services/auth/authErrorPolicy.test.ts",
    "src/tests/services/auth/authRequestHeaders.test.ts",
    "src/tests/services/auth/googleLoginLock.test.ts",
    "src/tests/services/authService.test.ts",
    "src/tests/services/admin/roleService.test.ts",
    "src/tests/security/netlifyHeadersStatic.test.ts",
    "src/tests/security/netlifyRuntimeIsolationStatic.test.ts",
    "src/tests/security/legacyRoleAliasStatic.test.ts",
    "src/tests/netlify/firebaseAuth.test.ts",
    "src/tests/netlify/sendCensusEmailFunction.test.ts",
    "src/tests/netlify/fhirApi.test.ts",
    "src/tests/netlify/cie10AiSearch.test.ts",
    "src/tests/netlify/aiProvider.test.ts",
    "src/tests/netlify/clinicalAiSummary.test.ts",
    "src/tests/services/backup/storageContracts.test.ts",
    "src/tests/services/backup/storageAvailability.test.ts",
    "src/tests/services/backup/censusStorageService.test.ts",
    "src/tests/services/backup/cudyrStorageService.test.ts",
    "src/tests/services/backup/pdfStorageRuntime.test.ts",
    "src/tests/services/storage/syncQueueLoad.test.ts"
  ],
  "excludedFromUnitSuite": [
    "src/tests/security/firestore-rules.test.ts",
    "src/tests/emulator/",
    "src/tests/emulator-ui/"
  ]
}
```

- [ ] **Step 2: Implement the membership checker**

Create `scripts/check-ci-risk-pack-membership.mjs`.

```js
#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'scripts/config/ci-test-risk-packs.json');

const fail = message => {
  console.error(`[ci-risk-pack-membership] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(CONFIG_PATH)) {
  fail('Missing scripts/config/ci-test-risk-packs.json');
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const criticalFiles = Array.isArray(config.criticalFiles) ? config.criticalFiles : [];
const excludedPrefixes = Array.isArray(config.excludedFromUnitSuite)
  ? config.excludedFromUnitSuite
  : [];

if (criticalFiles.length === 0) {
  fail('criticalFiles is empty');
}

const missingFiles = criticalFiles.filter(file => !fs.existsSync(path.join(ROOT, file)));
if (missingFiles.length > 0) {
  fail(`Critical risk files do not exist:\n${missingFiles.map(file => `- ${file}`).join('\n')}`);
}

const excludedCriticalFiles = criticalFiles.filter(file =>
  excludedPrefixes.some(prefix => file === prefix || file.startsWith(prefix))
);
if (excludedCriticalFiles.length > 0) {
  fail(
    `Critical risk files are excluded from test:ci:unit:\n${excludedCriticalFiles
      .map(file => `- ${file}`)
      .join('\n')}`
  );
}

console.log(`[ci-risk-pack-membership] OK (${criticalFiles.length} critical files covered)`);
```

- [ ] **Step 3: Add the npm script**

Modify `package.json` scripts:

```json
{
  "check:ci-risk-pack-membership": "node scripts/check-ci-risk-pack-membership.mjs"
}
```

- [ ] **Step 4: Validate**

Run:

```bash
npm run check:ci-risk-pack-membership
```

Expected:

```text
[ci-risk-pack-membership] OK (25 critical files covered)
```

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/config/ci-test-risk-packs.json scripts/check-ci-risk-pack-membership.mjs
git commit -m "test: govern ci risk pack membership"
```

---

### Task 2: Remove Duplicate Unit Risk Re-Runs Without Lowering Coverage

**Files:**

- Modify: `.github/workflows/ci-cd.yml`
- Modify: `package.json`

- [ ] **Step 1: Keep risk scripts for local targeted use**

Do not delete these scripts from `package.json`:

```text
test:resilience
test:risk:admin-health
test:risk:auth
test:risk:platform
test:sync-load
test:unit:critical
```

They remain useful locally and for release-confidence packs.

- [ ] **Step 2: Modify the CI unit job so the full suite runs once**

In `.github/workflows/ci-cd.yml`, replace the duplicated `unit-risk` steps with:

```yaml
- name: Run unit and integration tests once
  run: npm run test:ci:unit
  env:
    CI: true

- name: Prove critical risk packs are included in the unit suite
  run: npm run check:ci-risk-pack-membership
```

Remove these CI-only duplicate run steps from `unit-risk`:

```yaml
- name: Run critical sync resilience tests
- name: Run admin health risk tests
- name: Run auth risk tests (popup/redirect/lock)
- name: Run platform risk tests (auth lock + netlify headers + backup contracts)
- name: Run sync queue load baseline
```

- [ ] **Step 3: Validate locally**

Run:

```bash
npm run check:ci-risk-pack-membership
npx vitest run src/tests/services/auth/googleLoginLock.test.ts src/tests/integration/sync-resilience.test.ts src/tests/services/storage/syncQueueLoad.test.ts
```

Expected: membership check passes and focused risk files pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci-cd.yml package.json scripts/config/ci-test-risk-packs.json scripts/check-ci-risk-pack-membership.mjs
git commit -m "ci: avoid duplicate unit risk executions"
```

---

### Task 3: Parallelize Independent CI Jobs

**Files:**

- Modify: `.github/workflows/ci-cd.yml`

- [ ] **Step 1: Remove unnecessary dependency on `quality-static`**

Change:

```yaml
unit-risk:
  needs: [quality-static]

rules-emulator:
  needs: [quality-static]

e2e-critical-emulator:
  needs: [quality-static]
```

To:

```yaml
unit-risk:
  # Runs in parallel with quality-static. The final ci-summary still requires both.

rules-emulator:
  # Runs in parallel with quality-static. Emulator failures should surface early.

e2e-critical-emulator:
  # Runs in parallel with quality-static. E2E failures should surface early.
```

In YAML, that means deleting the `needs: [quality-static]` lines from those three jobs.

- [ ] **Step 2: Keep the final blocking aggregation unchanged**

Keep:

```yaml
build:
  needs: [quality-static, unit-risk, rules-emulator, e2e-critical-emulator]

ci-strict-summary:
  needs: [quality-static, unit-risk, rules-emulator, e2e-critical-emulator, build]
```

This preserves the release-blocking bar while reducing wall time.

- [ ] **Step 3: Validate workflow syntax**

Run:

```bash
npx prettier --check .github/workflows/ci-cd.yml
```

Expected: YAML formatting passes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci-cd.yml
git commit -m "ci: run independent gates in parallel"
```

---

### Task 4: Shard the Full Vitest Unit Suite While Preserving Stable Check Names

**Files:**

- Modify: `.github/workflows/ci-cd.yml`
- Modify: `package.json`

- [ ] **Step 1: Add sharded npm scripts**

Modify `package.json` scripts:

```json
{
  "test:ci:unit:shard": "vitest run --exclude \"src/tests/security/firestore-rules.test.ts\" --exclude \"src/tests/emulator/**\" --exclude \"src/tests/emulator-ui/**\" --shard"
}
```

The GitHub command will pass `1/4`, `2/4`, `3/4`, and `4/4`.

- [ ] **Step 2: Convert unit execution to a matrix**

Replace the single `unit-risk` job with two jobs:

```yaml
unit-risk-shards:
  name: unit-risk-shard-${{ matrix.shard }}
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      shard: [1, 2, 3, 4]
  steps:
    - name: Checkout code
      uses: actions/checkout@v6
    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: '22'
        cache: 'npm'
    - name: Install dependencies
      run: npm ci
    - name: Run unit shard
      run: npm run test:ci:unit:shard -- ${{ matrix.shard }}/4
      env:
        CI: true

unit-risk:
  name: unit-risk
  runs-on: ubuntu-latest
  needs: [unit-risk-shards]
  steps:
    - name: Checkout code
      uses: actions/checkout@v6
    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: '22'
        cache: 'npm'
    - name: Install dependencies
      run: npm ci
    - name: Prove critical risk packs are included in the unit suite
      run: npm run check:ci-risk-pack-membership
    - name: Unit shards passed
      run: echo "All unit-risk shards passed."
```

This keeps the existing required status check name `unit-risk` while allowing parallel test execution.

- [ ] **Step 3: Validate one shard locally**

Run:

```bash
npm run test:ci:unit:shard -- 1/4
```

Expected: the shard passes and does not run Firestore rules or emulator-only suites.

- [ ] **Step 4: Validate all shards locally if time allows**

Run:

```bash
npm run test:ci:unit:shard -- 1/4
npm run test:ci:unit:shard -- 2/4
npm run test:ci:unit:shard -- 3/4
npm run test:ci:unit:shard -- 4/4
```

Expected: all shards pass. If one shard is much slower, adjust to 5 shards only after capturing durations.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci-cd.yml package.json
git commit -m "ci: shard unit risk suite"
```

---

### Task 5: Move Built Flow Performance Out of E2E Critical

**Files:**

- Modify: `scripts/run-e2e-critical-emulator-ci.sh`
- Modify: `.github/workflows/ci-cd.yml`
- Modify: `package.json`

- [ ] **Step 1: Add a pure E2E critical script**

Modify `package.json` scripts:

```json
{
  "test:e2e:critical:emulator-only": "unset NO_COLOR; playwright test -c playwright.emulator-critical.config.ts e2e/critical-emulator.spec.ts e2e/auth-multi-tab-lock.spec.ts e2e/pre-outbox-multitab.spec.ts e2e/auth-login-resilience.spec.ts e2e/authenticated-clinical-smoke.spec.ts e2e/release-role-smoke.spec.ts e2e/clinical-document-ai-import.spec.ts e2e/legacy-firebase-compat.spec.ts e2e/sync-conflict-resolution.spec.ts e2e/census-persistence-reload.spec.ts e2e/multiuser-offline-conflict.spec.ts e2e/admit-edit-discharge-smoke.spec.ts"
}
```

- [ ] **Step 2: Remove the build from `run-e2e-critical-emulator-ci.sh`**

Change:

```bash
run_firestore_emulator_exec \
  "npm run build && npm run test:e2e:critical && npm run test:e2e:flow-performance:built && npm run check:flow-performance-budget"
```

To:

```bash
run_firestore_emulator_exec "npm run test:e2e:critical:emulator-only"
```

- [ ] **Step 3: Run built flow performance in the build job after production build**

In `.github/workflows/ci-cd.yml`, add this after `Build production bundle` in the `build` job:

```yaml
- name: Validate built flow performance budget
  run: npm run test:e2e:flow-performance:built && npm run check:flow-performance-budget
  env:
    CI: true
    PLAYWRIGHT_SKIP_PREVIEW_BUILD: '1'
```

If this spec requires Firestore emulator on CI, keep it in `e2e-critical` and only set `PLAYWRIGHT_SKIP_PREVIEW_BUILD=1` after the existing build. Do not merge this task until that is proven by a CI run.

- [ ] **Step 4: Validate locally**

Run:

```bash
npm run test:e2e:critical:ci
npm run build
PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 npm run test:e2e:flow-performance:built
npm run check:flow-performance-budget
```

Expected: E2E critical passes, built flow performance report is generated, and flow budget check passes.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/run-e2e-critical-emulator-ci.sh .github/workflows/ci-cd.yml
git commit -m "ci: split critical e2e from built flow budget"
```

---

### Task 6: Remove Duplicate Preview-Gate Checks From Build Budget

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci-cd.yml`

- [ ] **Step 1: Add a preview-smoke-only script**

Modify `package.json` scripts:

```json
{
  "test:e2e:preview:census-bootstrap:built": "PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 playwright test -c playwright.preview.config.ts e2e/census-preview-bootstrap.spec.ts --project=chromium",
  "ci:preview-smoke:built": "npm run test:e2e:preview:census-bootstrap:built"
}
```

Keep `ci:preview-gate` unchanged for local/release use.

- [ ] **Step 2: Use the smoke-only script inside the build job**

Change the `build` job from:

```yaml
- name: Enforce bundle budget
  run: npm run check:bundle-budget

- name: Validate chunk import graph (no vendor<->feature cycles)
  run: npm run check:chunk-graph

- name: Validate production preview bootstrap
  run: npm run ci:preview-gate
```

To:

```yaml
- name: Enforce bundle budget
  run: npm run check:bundle-budget

- name: Validate chunk import graph (no vendor<->feature cycles)
  run: npm run check:chunk-graph

- name: Validate production preview bootstrap
  run: npm run ci:preview-smoke:built
  env:
    CI: true
    PLAYWRIGHT_SKIP_PREVIEW_BUILD: '1'
    PLAYWRIGHT_PREVIEW_ARTIFACTS_DIR: reports/e2e/preview-bootstrap
```

- [ ] **Step 3: Validate locally**

Run:

```bash
npm run build
npm run check:bundle-budget
npm run check:chunk-graph
PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 PLAYWRIGHT_PREVIEW_ARTIFACTS_DIR=reports/e2e/preview-bootstrap npm run ci:preview-smoke:built
```

Expected: bundle checks pass once, preview bootstrap passes, and `reports/e2e/preview-bootstrap/report.json` exists.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci-cd.yml
git commit -m "ci: avoid duplicate preview gate checks"
```

---

### Task 7: Add CI Runtime Evidence for PR Review

**Files:**

- Create: `scripts/report-ci-runtime-baseline.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create a lightweight runtime report helper**

Create `scripts/report-ci-runtime-baseline.mjs`.

```js
#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node scripts/report-ci-runtime-baseline.mjs <github-run-id>');
  process.exit(1);
}

const result = spawnSync(
  'gh',
  [
    'run',
    'view',
    runId,
    '--json',
    'jobs',
    '--jq',
    '.jobs[] | {name, conclusion, startedAt, completedAt, durationSec: ((.completedAt | fromdateiso8601) - (.startedAt | fromdateiso8601))}',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);

process.exit(result.status ?? 1);
```

- [ ] **Step 2: Add script**

Modify `package.json` scripts:

```json
{
  "report:ci-runtime-baseline": "node scripts/report-ci-runtime-baseline.mjs"
}
```

- [ ] **Step 3: Validate with known run**

Run:

```bash
npm run report:ci-runtime-baseline -- 28485560000
```

Expected: prints per-job durations matching the current baseline.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/report-ci-runtime-baseline.mjs
git commit -m "ci: document workflow runtime baseline"
```

---

### Task 8: PR Validation and Merge Criteria

**Files:**

- No new files unless evidence reports are regenerated by existing scripts.

- [ ] **Step 1: Run local fast validation**

Run:

```bash
npm run check:ci-risk-pack-membership
npm run typecheck
npx prettier --check .github/workflows/ci-cd.yml package.json scripts/check-ci-risk-pack-membership.mjs scripts/report-ci-runtime-baseline.mjs
```

Expected: all pass.

- [ ] **Step 2: Run representative tests**

Run:

```bash
npm run test:ci:unit:shard -- 1/4
npm run test:e2e:critical:ci
npm run build
PLAYWRIGHT_SKIP_PREVIEW_BUILD=1 npm run ci:preview-smoke:built
```

Expected: all pass. If `test:e2e:critical:ci` is too slow locally, record that remote CI is the final proof for the E2E split.

- [ ] **Step 3: Open PR and compare CI duration**

After pushing the branch, wait for CI completion and run:

```bash
gh run list --workflow ci-cd.yml --branch codex/ci-test-runtime-reduction --limit 1 --json databaseId --jq '.[0].databaseId'
npm run report:ci-runtime-baseline -- <new-run-id>
```

Expected:

```text
quality-static remains about 15m
unit-risk aggregate completes after shard completion
unit shards each remain substantially below the previous 11m single job
overall wall time is below 20m
```

- [ ] **Step 4: Compare quality level**

Before marking ready for merge, verify:

```bash
gh pr view <pr-number> --json mergeStateStatus,statusCheckRollup,reviewDecision
```

Expected:

```text
quality-static: success
unit-risk: success
rules-emulator: success
e2e-critical: success
build-budget: success
ci-summary: success
CodeRabbit/Greptile: success or addressed
```

- [ ] **Step 5: Merge-readiness rule**

Do not merge if any of these are true:

```text
Any risk-pack file is no longer covered by the full unit suite.
Any E2E spec is removed from the blocking critical set without a replacement contract.
Any required status-check name disappears without confirming branch protection.
CI time improves only by hiding failed or skipped gates.
```

Commit final evidence updates only if existing report freshness gates require it.

```bash
git status --short
git commit -m "chore: refresh ci runtime evidence"
```

---

## Recommended PR Shape

Use one PR with four to six commits:

1. `test: govern ci risk pack membership`
2. `ci: avoid duplicate unit risk executions`
3. `ci: run independent gates in parallel`
4. `ci: shard unit risk suite`
5. `ci: split critical e2e from built flow budget`
6. `ci: avoid duplicate preview gate checks`

If Task 5 shows uncertainty around Firestore requirements for flow performance, split it into a second PR. Tasks 1-4 and 6 are already enough to reduce wall time materially without changing the clinical safety surface.

## Expected Impact

- Conservative PR target: 31-35m -> 17-20m wall time.
- Ambitious target after stable sharding: 31-35m -> 12-15m wall time.
- Quality preserved by:
  - full Vitest suite still running
  - Firestore rules/emulator still blocking
  - E2E critical still blocking
  - production build/bundle/preview still blocking
  - critical risk-pack membership checked explicitly
  - aggregate status names retained for branch protection
