import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectCiArtifactContractIssues } from '../../../scripts/ciArtifactContractSupport.mjs';

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const readPackageScripts = () => {
  const manifest = JSON.parse(readText('package.json'));
  return manifest.scripts as Record<string, string>;
};

const workflowFiles = fs
  .readdirSync(path.join(process.cwd(), '.github', 'workflows'))
  .filter(fileName => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
  .map(fileName => path.join('.github', 'workflows', fileName));

describe('CI workflow governance', () => {
  it('uses the logged governance snapshot runner so CI exposes long report substeps', () => {
    const scripts = readPackageScripts();
    const runner = readText('scripts/run-governance-snapshots.mjs');
    const support = readText('scripts/governanceSnapshotSupport.mjs');

    expect(scripts['report:governance-snapshots']).toBe(
      'node scripts/run-governance-snapshots.mjs'
    );
    expect(support).toContain('release-readiness-scorecard');
    expect(support).toContain('clinical-release-signoff');
    expect(support).toContain('runtime-contracts');
    expect(support).toContain('maintenance-debt-scorecard');
    expect(runner).toContain('::group::');
    expect(support).toContain('ci-governance-snapshot-profile');
  });

  it('keeps release readiness generation behind a cache-aware runner instead of an opaque npm chain', () => {
    const scripts = readPackageScripts();

    expect(scripts['report:release-readiness-scorecard']).toBe(
      'node scripts/run-release-readiness-scorecard.mjs'
    );
  });

  it('enforces strict report freshness immediately after regenerating governance snapshots', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');
    const snapshotStep = workflow.indexOf('npm run report:governance-snapshots');
    const freshnessStep = workflow.indexOf('npm run check:report-freshness:strict');

    expect(snapshotStep).toBeGreaterThanOrEqual(0);
    expect(freshnessStep).toBeGreaterThan(snapshotStep);
  });

  it('splits quality-static into governed groups while preserving an aggregate quality-static check', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');

    expect(workflow).toContain('quality-static-governance-snapshots:');
    expect(workflow).toContain('quality-static-groups:');
    expect(workflow).toContain('name: quality-static-${{ matrix.group }}');
    expect(workflow).toContain('group: [boundaries, governance, security, size, tests, reports]');
    expect(workflow).toContain('run: npm run check:quality:group -- ${{ matrix.group }}');
    expect(workflow).toContain('quality-static:');
    expect(workflow).toContain(
      'needs: [quality-static-governance-snapshots, quality-static-groups]'
    );
    expect(workflow).toContain('Quality static gates passed');
    expect(workflow).toContain('name: quality-static-governance-snapshots');
    expect(workflow).toContain("if: matrix.group == 'governance'");
  });

  it('persists critical coverage as an explicit artifact for governance snapshots', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');

    expect(workflow).toContain('critical-coverage-report:');
    expect(workflow).toContain('name: critical-coverage-report');
    expect(workflow).toContain('run: npm run report:critical-coverage');
    expect(workflow).toContain('name: critical-coverage');
    expect(workflow).toContain('path: reports/critical-coverage.*');
    expect(workflow).toContain('uses: actions/download-artifact@v7');
    expect(workflow).toContain('reports/ci-governance-snapshot-profile.*');
  });

  it('promotes the clinical sync simulator to a visible release gate with evidence artifacts', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');
    const scripts = readPackageScripts();
    const syncGateJob = workflow.slice(
      workflow.indexOf('clinical-sync-release-gate:'),
      workflow.indexOf('unit-risk-shards:')
    );
    const simulatorStep = syncGateJob.indexOf('npm run test:clinical-sync-simulator');
    const reportStep = syncGateJob.indexOf('npm run report:sync-convergence');
    const contractStep = syncGateJob.indexOf('npm run check:sync-convergence-evidence');
    const freshnessStep = syncGateJob.indexOf('npm run check:sync-convergence-freshness:strict');
    const uploadStep = syncGateJob.indexOf('name: sync-convergence');
    const buildJob = workflow.slice(workflow.indexOf('build:'), workflow.indexOf('lighthouse-ci:'));
    const summaryJob = workflow.slice(
      workflow.indexOf('ci-strict-summary:'),
      workflow.indexOf('postmerge-evidence:')
    );

    expect(scripts['test:clinical-sync-simulator']).toBe(
      'vitest run src/tests/support/clinicalSyncSimulator'
    );
    expect(scripts['check:sync-convergence-freshness:strict']).toBe(
      'node scripts/check-report-freshness.mjs --strict --only sync-convergence'
    );
    expect(syncGateJob).toContain('clinical-sync-release-gate:');
    expect(syncGateJob).toContain('name: clinical-sync-release-gate');
    expect(simulatorStep).toBeGreaterThanOrEqual(0);
    expect(reportStep).toBeGreaterThan(simulatorStep);
    expect(contractStep).toBeGreaterThan(reportStep);
    expect(freshnessStep).toBeGreaterThan(contractStep);
    expect(uploadStep).toBeGreaterThan(freshnessStep);
    expect(syncGateJob).toContain('path: reports/sync-convergence.*');
    expect(buildJob).toContain(
      'needs: [quality-static, unit-risk, clinical-sync-release-gate, rules-emulator, e2e-critical-emulator]'
    );
    expect(summaryJob).toContain('ci-runtime-telemetry');
    expect(summaryJob).toContain('clinical-sync-release-gate: passed');
  });

  it('collects real GitHub Actions runtime after PR-blocking gates finish', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');
    const scripts = readPackageScripts();
    const unitRiskJob = workflow.slice(
      workflow.indexOf('unit-risk:'),
      workflow.indexOf('rules-emulator:')
    );
    const telemetryJob = workflow.slice(
      workflow.indexOf('ci-runtime-telemetry:'),
      workflow.indexOf('ci-strict-summary:')
    );
    const summaryJob = workflow.slice(
      workflow.indexOf('ci-strict-summary:'),
      workflow.indexOf('postmerge-evidence:')
    );
    const collectStep = telemetryJob.indexOf('npm run collect:ci-runtime-observed-input');
    const reportStep = telemetryJob.indexOf('npm run report:ci-runtime-observed-profile');
    const checkStep = telemetryJob.indexOf('npm run check:ci-runtime-telemetry');
    const uploadStep = telemetryJob.indexOf('name: ci-runtime-observed-profile');

    expect(scripts['collect:ci-runtime-observed-input']).toBe(
      'node scripts/collect-github-actions-runtime.mjs'
    );
    expect(unitRiskJob).not.toContain('npm run report:ci-runtime-observed-profile');
    expect(telemetryJob).toContain('ci-runtime-telemetry:');
    expect(telemetryJob).toContain('name: ci-runtime-telemetry');
    expect(telemetryJob).toContain(
      'needs: [quality-static, unit-risk, clinical-sync-release-gate, rules-emulator, e2e-critical-emulator, build]'
    );
    expect(telemetryJob).toContain('actions: read');
    expect(telemetryJob).toContain('contents: read');
    expect(telemetryJob).toContain('persist-credentials: false');
    expect(telemetryJob).toContain("CI_RUNTIME_COLLECTION_REQUIRED: '1'");
    expect(telemetryJob).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(collectStep).toBeGreaterThanOrEqual(0);
    expect(reportStep).toBeGreaterThan(collectStep);
    expect(checkStep).toBeGreaterThan(reportStep);
    expect(uploadStep).toBeGreaterThan(checkStep);
    expect(telemetryJob).toContain('path: reports/ci-runtime-observed-*');
    expect(summaryJob).toContain('ci-runtime-telemetry');
    expect(summaryJob).toContain('permissions: {}');
    expect(summaryJob).toContain('ci-runtime-telemetry: passed');
  });

  it('keeps expensive clinical/runtime suites in a scheduled nightly workflow', () => {
    const workflow = readText('.github/workflows/nightly-test-runtime.yml');
    const scripts = readPackageScripts();

    expect(workflow).toContain('name: Nightly Test Runtime Governance');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('schedule:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).toContain('npm run test:sync-load');
    expect(workflow).toContain('npm run test:release-confidence:full');
    expect(workflow).toContain('npm run test:e2e:clinical-stability:ci');
    expect(workflow).toContain('name: test-runtime-governance');
    expect(workflow).toContain('reports/test-runtime-governance.*');
    expect(scripts['check:test-runtime-governance']).toBe(
      'node scripts/check-test-runtime-governance.mjs'
    );
    expect(scripts['report:test-runtime-governance']).toBe(
      'node scripts/report-test-runtime-governance.mjs'
    );
  });

  it('self-checks post-merge evidence before uploading the main artifact', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');
    const scripts = readPackageScripts();
    const buildJob = workflow.slice(workflow.indexOf('build:'), workflow.indexOf('lighthouse-ci:'));
    const summaryJob = workflow.slice(
      workflow.indexOf('ci-strict-summary:'),
      workflow.indexOf('postmerge-evidence:')
    );
    const postmergeJob = workflow.slice(workflow.indexOf('postmerge-evidence:'));
    const buildStep = buildJob.indexOf('npm run build');
    const uploadDistStep = buildJob.indexOf('name: dist');
    const artifactContractStep = postmergeJob.indexOf('npm run check:ci-artifact-contracts');
    const availabilityStep = postmergeJob.indexOf('scripts/verify-github-run-artifact.mjs');
    const downloadDistStep = postmergeJob.indexOf('name: dist');
    const generateStep = postmergeJob.indexOf('npm run postmerge:evidence');
    const checkStep = postmergeJob.indexOf('npm run check:postmerge-evidence:strict');
    const uploadStep = postmergeJob.indexOf('name: postmerge-release-evidence');

    expect(scripts['check:ci-artifact-contracts']).toBe(
      'node scripts/check-ci-artifact-contracts.mjs'
    );
    expect(collectCiArtifactContractIssues(workflow)).toEqual([]);
    expect(buildStep).toBeGreaterThanOrEqual(0);
    expect(uploadDistStep).toBeGreaterThan(buildStep);
    expect(summaryJob).not.toContain('actions/upload-artifact@v7');
    expect(postmergeJob).toContain('postmerge-evidence:');
    expect(postmergeJob).toContain(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'"
    );
    expect(postmergeJob).toContain('needs: [build, ci-strict-summary]');
    expect(postmergeJob).toContain('actions: read');
    expect(postmergeJob).toContain('uses: actions/download-artifact@v7');
    expect(artifactContractStep).toBeGreaterThanOrEqual(0);
    expect(availabilityStep).toBeGreaterThan(artifactContractStep);
    expect(downloadDistStep).toBeGreaterThanOrEqual(0);
    expect(downloadDistStep).toBeGreaterThan(availabilityStep);
    expect(generateStep).toBeGreaterThanOrEqual(0);
    expect(generateStep).toBeGreaterThan(downloadDistStep);
    expect(checkStep).toBeGreaterThan(generateStep);
    expect(uploadStep).toBeGreaterThan(checkStep);
  });

  it('rejects dist artifacts uploaded by jobs that did not build production assets', () => {
    const brokenWorkflow = `
jobs:
  build:
    steps:
      - name: Build production bundle
        run: npm run build
  ci-strict-summary:
    needs: [build]
    steps:
      - name: Upload build artifacts
        uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist/
  postmerge-evidence:
    needs: [ci-strict-summary]
    steps:
      - name: Download build artifacts
        uses: actions/download-artifact@v7
        with:
          name: dist
          path: dist
`;

    expect(collectCiArtifactContractIssues(brokenWorkflow)).toContain(
      'ci-strict-summary: uploads artifact "dist" without running npm run build earlier in the same job.'
    );
  });

  it('does not read artifact fields across unnamed step boundaries', () => {
    const brokenWorkflow = `
jobs:
  build:
    steps:
      - name: Build production bundle
        run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist/
      - run: echo "unnamed follow-up step"
        with:
          name: wrong-artifact-name
          path: distribution/
  postmerge-evidence:
    needs: [build]
    steps:
      - name: Validate CI artifact contract
        run: npm run check:ci-artifact-contracts
      - name: Verify build artifact availability
        run: node scripts/verify-github-run-artifact.mjs --artifact dist --producer build-budget
      - uses: actions/download-artifact@v7
        with:
          name: dist
          path: dist
`;

    expect(collectCiArtifactContractIssues(brokenWorkflow)).toEqual([]);
  });

  it('requires dist artifacts to use an exact dist path boundary', () => {
    const brokenWorkflow = `
jobs:
  build:
    steps:
      - name: Build production bundle
        run: npm run build
      - name: Upload production build artifact
        uses: actions/upload-artifact@v7
        with:
          name: dist
          path: distribution/
  postmerge-evidence:
    needs: [build]
    steps:
      - name: Validate CI artifact contract
        run: npm run check:ci-artifact-contracts
      - name: Verify build artifact availability
        run: node scripts/verify-github-run-artifact.mjs --artifact dist --producer build-budget
      - name: Download build artifacts
        uses: actions/download-artifact@v7
        with:
          name: dist
          path: dist
`;

    expect(collectCiArtifactContractIssues(brokenWorkflow)).toContain(
      'build: uploads artifact "dist" from "distribution/"; expected dist/.'
    );
  });

  it('keeps Firefox compatibility out of PR CI unless Firefox becomes a supported browser', () => {
    const workflow = readText('.github/workflows/ci-cd.yml');

    expect(workflow).not.toContain('e2e-firefox-compat');
    expect(workflow).not.toContain('E2E_CRITICAL_BROWSERS: firefox');
    expect(workflow).not.toContain('playwright install --with-deps firefox');
  });

  it('runs the dependency security workflow when the audit scripts change', () => {
    const workflow = readText('.github/workflows/security-audit.yml');

    expect(workflow).toContain('scripts/check-dependency-vulnerabilities.mjs');
    expect(workflow).toContain('scripts/lib/dependencyAuditSupport.mjs');
    expect(workflow).toContain('.github/workflows/security-audit.yml');
  });

  it('deploys explicit Firebase function targets without a sweeping delete pass', () => {
    const workflow = readText('.github/workflows/deploy-functions.yml');
    const targetScript = readText('scripts/list-firebase-function-targets.mjs');

    expect(workflow).toContain('node scripts/list-firebase-function-targets.mjs');
    expect(workflow).toContain('--only "${FUNCTION_TARGETS}"');
    expect(workflow).not.toContain('--only functions \\');
    expect(workflow).toContain('--force');
    expect(targetScript).toContain('functions:');
    expect(targetScript).not.toContain('cleanExpiredPrescriptions');
  });

  it('opts GitHub JavaScript actions into Node 24 before the runner default changes', () => {
    for (const workflowFile of workflowFiles) {
      const workflow = readText(workflowFile);

      expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    }
  });

  it('uses Node 24-native GitHub action majors instead of deprecated Node 20 actions', () => {
    const deprecatedActions = [
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/upload-artifact@v4',
    ];

    for (const workflowFile of workflowFiles) {
      const workflow = readText(workflowFile);

      for (const action of deprecatedActions) {
        expect(workflow, `${workflowFile} should not use ${action}`).not.toContain(action);
      }
    }
  });
});
