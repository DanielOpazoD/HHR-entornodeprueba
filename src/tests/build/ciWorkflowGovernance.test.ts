// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';

import {
  collectArtifactDownloads,
  collectArtifactUploads,
  collectCiArtifactContractIssues,
  collectTransitiveNeeds,
  parseWorkflowJobs,
} from '../../../scripts/ciArtifactContractSupport.mjs';
import { parseWorkflow } from './workflowYamlTestSupport';

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

/** The real workflow with its postmerge-evidence steps edited through the YAML document. */
const mutatePostmergeSteps = (mutate: (steps: YAMLSeq<YAMLMap>) => void) => {
  const document = parseDocument(readText('.github/workflows/ci-cd.yml'));
  mutate(document.getIn(['jobs', 'postmerge-evidence', 'steps']) as YAMLSeq<YAMLMap>);
  return String(document);
};

const findStep = (steps: YAMLSeq<YAMLMap>, predicate: (step: YAMLMap) => boolean) => {
  const index = steps.items.findIndex(predicate);
  expect(index).toBeGreaterThan(-1);
  return { index, step: steps.items[index] };
};

const isPreviewDownload = (step: YAMLMap) =>
  String(step.get('uses')).startsWith('actions/download-artifact@') &&
  step.getIn(['with', 'name']) === 'preview-bootstrap-artifacts';

describe('CI workflow governance', () => {
  it('rejects a missing preview bootstrap download or incorrect producer contract', () => {
    const withoutDownload = mutatePostmergeSteps(steps => {
      steps.items.splice(findStep(steps, isPreviewDownload).index, 1);
    });
    const wrongProducer = mutatePostmergeSteps(steps => {
      const verify =
        '--artifact preview-bootstrap-artifacts --producer final-confidence-and-readiness';
      const { step } = findStep(steps, candidate => String(candidate.get('run')).includes(verify));
      step.set(
        'run',
        String(step.get('run')).replace(
          verify,
          '--artifact preview-bootstrap-artifacts --producer other-job'
        )
      );
    });
    const wrongDownloadPath = mutatePostmergeSteps(steps => {
      findStep(steps, isPreviewDownload).step.setIn(['with', 'path'], '.');
    });

    expect(collectCiArtifactContractIssues(withoutDownload)).toContain(
      'postmerge-evidence: must download artifact "preview-bootstrap-artifacts".'
    );
    expect(collectCiArtifactContractIssues(wrongProducer)).toContain(
      'postmerge-evidence: must verify "preview-bootstrap-artifacts" from producer "final-confidence-and-readiness".'
    );
    expect(collectCiArtifactContractIssues(wrongDownloadPath)).toContain(
      'postmerge-evidence: preview bootstrap must download to "reports/e2e/preview-bootstrap".'
    );
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
          if-no-files-found: error
          overwrite: true
      - run: echo "unnamed follow-up step"
        with:
          name: wrong-artifact-name
          path: distribution/
  final-confidence-and-readiness:
    steps:
      - name: Record preview bootstrap artifact provenance
        run: npm run write:preview-bootstrap-provenance
      - name: Validate preview bootstrap artifact evidence
        run: npm run check:preview-bootstrap-evidence
      - uses: actions/upload-artifact@v7
        with:
          name: preview-bootstrap-artifacts
          path: reports/e2e/preview-bootstrap/
          if-no-files-found: error
          overwrite: true
  postmerge-evidence:
    needs: [build, final-confidence-and-readiness]
    steps:
      - name: Validate CI artifact contract
        run: npm run check:ci-artifact-contracts
      - name: Verify build artifact availability
        run: node scripts/verify-github-run-artifact.mjs --artifact dist --producer build-budget
      - name: Verify preview bootstrap artifact availability
        run: node scripts/verify-github-run-artifact.mjs --artifact preview-bootstrap-artifacts --producer final-confidence-and-readiness
      - uses: actions/download-artifact@v7
        with:
          name: dist
          path: dist
      - name: Download preview bootstrap artifacts
        uses: actions/download-artifact@v7
        with:
          name: preview-bootstrap-artifacts
          path: reports/e2e/preview-bootstrap
      - name: Validate downloaded preview bootstrap evidence
        run: npm run check:preview-bootstrap-evidence
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

  it('uses the supported setup-java major in every Java workflow', () => {
    const setupJavaUses = [
      '.github/workflows/ci-cd.yml',
      '.github/workflows/nightly-test-runtime.yml',
    ].flatMap(workflowPath => readText(workflowPath).match(/actions\/setup-java@[^\s]+/g) ?? []);

    expect(setupJavaUses.length).toBeGreaterThan(0);
    expect(new Set(setupJavaUses)).toEqual(new Set(['actions/setup-java@v6']));
  });
});

describe('CI artifact contracts', () => {
  const ciWorkflow = readText('.github/workflows/ci-cd.yml');

  /** The same workflow GitHub would run, written differently: 4-space indent, quoted scalars. */
  const reformat = (text: string) =>
    parseDocument(text).toString({ indent: 4, defaultStringType: 'QUOTE_DOUBLE' });

  /** Block `needs:` lists rewritten as flow lists, `needs: [a, b]`. */
  const withFlowNeeds = (text: string) =>
    text.replace(
      /^( +)needs:\n((?:\1 +- .+\n)+)/gm,
      (_match, indent: string, items: string) =>
        `${indent}needs: [${items
          .trim()
          .split('\n')
          .map(item => item.replace(/^\s*-\s*/, ''))
          .join(', ')}]\n`
    );

  const mutateArtifact = (name: string, before: string, after: string) => {
    const artifact = collectArtifactUploads(parseWorkflowJobs(ciWorkflow)).find(
      upload => upload.name === name
    );
    if (!artifact) throw new Error(`Missing artifact: ${name}`);
    expect(artifact.block).toContain(before);
    return ciWorkflow.replace(artifact.block, artifact.block.replace(before, after));
  };

  it('replaces stale build artifacts and fails when the new output is missing', () => {
    const stalePreview = mutateArtifact(
      'preview-bootstrap-artifacts',
      'overwrite: true',
      'overwrite: false'
    );
    const staleDist = mutateArtifact('dist', 'overwrite: true', 'overwrite: false');
    const missingPreview = mutateArtifact(
      'preview-bootstrap-artifacts',
      'if-no-files-found: error',
      'if-no-files-found: warn'
    );
    const missingDist = mutateArtifact(
      'dist',
      'if-no-files-found: error',
      'if-no-files-found: warn'
    );

    expect(collectCiArtifactContractIssues(ciWorkflow)).toEqual([]);
    expect(collectCiArtifactContractIssues(stalePreview)).toContain(
      'final-confidence-and-readiness: preview bootstrap upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(staleDist)).toContain(
      'build: dist upload must replace an artifact from an earlier run attempt.'
    );
    expect(collectCiArtifactContractIssues(missingPreview)).toContain(
      'final-confidence-and-readiness: preview bootstrap upload must fail when new evidence is missing.'
    );
    expect(collectCiArtifactContractIssues(missingDist)).toContain(
      'build: dist upload must fail when the new build is missing.'
    );
  });

  it('judges the workflow GitHub runs, not how its YAML is formatted', () => {
    expect(collectCiArtifactContractIssues(ciWorkflow)).toEqual([]);
    expect(collectCiArtifactContractIssues(reformat(ciWorkflow))).toEqual([]);
    expect(collectCiArtifactContractIssues(withFlowNeeds(reformat(ciWorkflow)))).toEqual([]);
  });

  it('holds a pattern download to the same producer and ordering contract as a named one', () => {
    const laneDownload = 'pattern: e2e-critical-lane-*';
    expect(ciWorkflow).toContain(laneDownload);
    expect(
      collectCiArtifactContractIssues(
        ciWorkflow.replace(laneDownload, 'pattern: e2e-critical-lanes-*')
      )
    ).toContain(
      'final-confidence-and-readiness: downloads artifact "e2e-critical-lanes-*" but no job uploads that artifact.'
    );
    const unordered = parseDocument(ciWorkflow);
    unordered.setIn(['jobs', 'final-confidence-and-readiness', 'needs'], ['ci-scope']);
    expect(collectCiArtifactContractIssues(String(unordered))).toContainEqual(
      expect.stringMatching(
        /^final-confidence-and-readiness: downloads artifact "e2e-critical-lane-\*" before declaring a needs chain/
      )
    );
    expect(
      collectCiArtifactContractIssues(ciWorkflow.replace(laneDownload, 'merge-multiple: false'))
    ).toContainEqual(
      expect.stringMatching(/download-artifact at line \d+ is missing name or pattern\.$/)
    );
  });

  it('still finds a real break after reformatting', () => {
    const document = parseDocument(ciWorkflow);
    const steps = document.getIn(['jobs', 'postmerge-evidence', 'steps']) as {
      items: { get: (key: string) => unknown }[];
    };
    const verifyIndex = steps.items.findIndex(step =>
      String(step.get('run') ?? '').includes('--artifact preview-bootstrap-artifacts')
    );
    expect(verifyIndex).toBeGreaterThan(-1);
    document.deleteIn(['jobs', 'postmerge-evidence', 'steps', verifyIndex]);

    expect(collectCiArtifactContractIssues(reformat(String(document)))).toContain(
      'postmerge-evidence: must verify "preview-bootstrap-artifacts" from producer "final-confidence-and-readiness".'
    );
  });

  it('runs Lighthouse against the validated dist from the same workflow without rebuilding', () => {
    const jobs = parseWorkflowJobs(ciWorkflow);
    const lighthouse = jobs.get('lighthouse-ci');
    const downloads = collectArtifactDownloads(jobs).filter(job => job.jobName === 'lighthouse-ci');
    const uploads = collectArtifactUploads(jobs).filter(artifact => artifact.name === 'dist');

    expect(lighthouse).toBeDefined();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ jobName: 'build', path: 'dist/' });
    expect(collectTransitiveNeeds(jobs, 'lighthouse-ci')).toContain('build');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatchObject({ name: 'dist', path: 'dist' });
    // Same-run artifact: no cross-run or cross-repository download inputs.
    for (const input of ['run-id', 'repository', 'artifact-ids'])
      expect(downloads[0].with).not.toHaveProperty(input);

    const job = parseWorkflow(ciWorkflow).jobs['lighthouse-ci'];
    const auditIndex = job.steps.findIndex(step =>
      step.uses?.startsWith('treosh/lighthouse-ci-action@')
    );
    expect(downloads[0].stepIndex).toBeLessThan(auditIndex);
    expect(job.steps.some(step => step.run?.includes('npm run build'))).toBe(false);
    expect(
      [job, ...job.steps].some(
        entry => (entry as { 'continue-on-error'?: unknown })['continue-on-error'] === true
      )
    ).toBe(false);
    expect(job.steps.some(step => step.uses === './.github/actions/setup-ci-dependencies')).toBe(
      true
    );
    expect(job.steps[auditIndex].with).toMatchObject({
      configPath: './lighthouserc.json',
      uploadArtifacts: true,
    });

    const config = JSON.parse(readText('lighthouserc.json'));
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.collect.startServerCommand).toBe(
      'npm run preview -- --port 4173 --host 127.0.0.1'
    );
  });

  it('recognizes Vite readiness with plain or ANSI-colored output, but not startup chatter', () => {
    const config = JSON.parse(readText('lighthouserc.json'));
    const readyPattern = new RegExp(config.ci.collect.startServerReadyPattern, 'i');

    // Vite inserts an ANSI reset between "Local" and ":" in GitHub Actions.
    for (const output of [
      '  ➜  Local:   http://127.0.0.1:4173/',
      '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m4173\u001b[22m/',
      '  Local\u001b[0m\u001b[39m:   http://127.0.0.1:4173/',
    ]) {
      expect(readyPattern.test(output)).toBe(true);
    }

    for (const output of [
      '',
      '> vite preview --port 4173 --host 127.0.0.1',
      'Error: Local server failed to start',
    ]) {
      expect(readyPattern.test(output)).toBe(false);
    }
  });
});
