// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { collectCiArtifactContractIssues } from '../../../scripts/ciArtifactContractSupport.mjs';
import {
  assertTelemetryAccess,
  jobNeeds,
  parseWorkflow,
  type WorkflowJob,
} from './workflowYamlTestSupport';

/**
 * Release evidence is only trustworthy when each job produces or fetches it,
 * validates it and only then publishes it. These contracts read the parsed
 * workflow, so job order, quoting or list style do not matter; only the order
 * of the steps inside each job does.
 */
type Step = WorkflowJob['steps'][number];
type Matcher = { label: string; position: (step: Step) => number | null };

const run = (command: string): Matcher => ({
  label: `run "${command}"`,
  position: step => {
    const offset = (step.run ?? '').indexOf(command);
    return offset === -1 ? null : offset;
  },
});
const artifactAction =
  (verb: 'upload' | 'download') =>
  (name: string): Matcher => ({
    label: `${verb} "${name}"`,
    position: step =>
      step.uses?.startsWith(`actions/${verb}-artifact@`) && step.with?.name === name ? 0 : null,
  });
const upload = artifactAction('upload');
const download = artifactAction('download');

export const EVIDENCE_PIPELINES: Record<string, Matcher[]> = {
  'critical-coverage-report': [
    download('critical-coverage-shard-1'),
    download('critical-coverage-shard-4'),
    run('node scripts/run-critical-coverage.mjs --merge-shards'),
    run('node scripts/report-critical-coverage.mjs'),
    run('node scripts/check-critical-coverage.mjs'),
    upload('critical-coverage'),
  ],
  'quality-static-governance-snapshots': [
    download('critical-coverage'),
    run('npm run report:governance-snapshots'),
    run('npm run check:report-freshness:strict'),
    run('npm run report:release-evidence-contract'),
    run('npm run check:release-evidence-contract:strict'),
    upload('release-evidence-runtime'),
    upload('quality-static-governance-snapshots'),
  ],
  'clinical-sync-release-gate': [
    run('npm run test:clinical-sync-simulator'),
    run('npm run report:sync-convergence'),
    run('npm run check:sync-convergence-evidence'),
    run('npm run check:sync-convergence-freshness:strict'),
    upload('sync-convergence'),
  ],
  build: [
    download('release-evidence-runtime'),
    run('npm run build'),
    run('npm run check:bundle-budget'),
    upload('dist'),
  ],
  'preview-smoke': [
    run('npx playwright merge-reports'),
    run('node scripts/check-preview-smoke-completeness.mjs'),
    run('npm run write:preview-bootstrap-provenance'),
    run('npm run check:preview-bootstrap-evidence'),
    upload('preview-bootstrap-artifacts'),
  ],
  'e2e-critical-emulator': [
    run('npm run test:e2e:critical:ci'),
    run('node scripts/report-e2e-operational-metrics.mjs'),
    upload('flow-performance-evidence'),
  ],
  'final-confidence-and-readiness': [
    download('preview-bootstrap-artifacts'),
    download('dist'),
    run('npm run check:preview-bootstrap-evidence'),
    download('flow-performance-evidence'),
    run('node scripts/check-playwright-report-clean.mjs reports/e2e/flow-performance'),
    run('npm run check:flow-performance-budget'),
    run('npm run report:operational-health'),
    run('npm run report:system-confidence'),
    run('npm run report:release-readiness-scorecard:from-current-inputs'),
    run('npm run check:report-freshness:strict -- --only operational-health'),
    upload('confidence-and-readiness'),
  ],
  'ci-runtime-telemetry': [
    run('npm run collect:ci-runtime-observed-input'),
    run('npm run report:ci-runtime-observed-profile'),
    run('npm run check:ci-runtime-telemetry'),
    upload('ci-runtime-observed-profile'),
  ],
  'postmerge-evidence': [
    run('npm run check:ci-artifact-contracts'),
    run('scripts/verify-github-run-artifact.mjs --artifact dist'),
    run(
      'scripts/verify-github-run-artifact.mjs --artifact preview-bootstrap-artifacts --producer preview-smoke'
    ),
    download('dist'),
    download('preview-bootstrap-artifacts'),
    download('release-evidence-runtime'),
    run('npm run check:preview-bootstrap-evidence'),
    run('npm run check:release-evidence-contract:built'),
    download('flow-performance-evidence'),
    run('npm run check:flow-performance-budget'),
    run('npm run postmerge:evidence'),
    run('npm run check:postmerge-evidence:strict'),
    upload('postmerge-release-evidence'),
  ],
};

/** Commands whose evidence must come from a single job. */
const EXCLUSIVE_COMMANDS: Record<string, string> = {
  'npm run report:ci-runtime-observed-profile': 'ci-runtime-telemetry',
  'npm run write:preview-bootstrap-provenance': 'preview-smoke',
  'npm run postmerge:evidence': 'postmerge-evidence',
};

const locate = (job: WorkflowJob, matcher: Matcher): [number, number] | null => {
  for (const [index, step] of job.steps.entries()) {
    const offset = matcher.position(step);
    if (offset !== null) return [index, offset];
  }
  return null;
};
const isBefore = ([stepA, offsetA]: [number, number], [stepB, offsetB]: [number, number]) =>
  stepA < stepB || (stepA === stepB && offsetA < offsetB);

export const collectPipelineIssues = (
  jobs: Record<string, WorkflowJob>,
  pipelines: Record<string, Matcher[]> = EVIDENCE_PIPELINES
) => {
  const issues: string[] = [];
  for (const [jobId, matchers] of Object.entries(pipelines)) {
    const job = jobs[jobId];
    if (!job) {
      issues.push(`${jobId}: job is missing.`);
      continue;
    }
    let previous: { label: string; at: [number, number] } | null = null;
    for (const matcher of matchers) {
      const at = locate(job, matcher);
      if (!at) {
        issues.push(`${jobId}: missing step ${matcher.label}.`);
        continue;
      }
      if (previous && !isBefore(previous.at, at)) {
        issues.push(`${jobId}: ${matcher.label} must run after ${previous.label}.`);
      }
      previous = { label: matcher.label, at };
    }
  }
  for (const [command, owner] of Object.entries(EXCLUSIVE_COMMANDS)) {
    const runners = Object.entries(jobs)
      .filter(([, job]) => job.steps.some(step => (step.run ?? '').includes(command)))
      .map(([jobId]) => jobId)
      .sort();
    if (runners.length !== 1 || runners[0] !== owner) {
      issues.push(`"${command}" must run only in ${owner}; found ${runners.join(', ') || 'none'}.`);
    }
  }
  return issues;
};

const readWorkflowText = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', file), 'utf8');
const ciText = readWorkflowText('ci-cd.yml');
const ciJobs = () => parseWorkflow(ciText).jobs;

/** Same workflow with jobs in reverse order: identical for GitHub Actions. */
const reorderedJobs = (text: string) => {
  const workflow = parse(text);
  workflow.jobs = Object.fromEntries(Object.entries(workflow.jobs).reverse());
  return stringify(workflow, { collectionStyle: 'block', defaultStringType: 'QUOTE_DOUBLE' });
};

describe('CI evidence pipelines', () => {
  it('produces or fetches, validates and then publishes evidence in every job', () => {
    expect(collectPipelineIssues(ciJobs())).toEqual([]);
    expect(collectCiArtifactContractIssues(ciText)).toEqual([]);
  });

  it('ignores job order, quoting and list style', () => {
    expect(collectPipelineIssues(parseWorkflow(reorderedJobs(ciText)).jobs)).toEqual([]);
  });

  it('rejects every missing or reordered evidence step', () => {
    for (const [jobId, matchers] of Object.entries(EVIDENCE_PIPELINES)) {
      for (const matcher of matchers) {
        const jobs = ciJobs();
        jobs[jobId].steps = jobs[jobId].steps.filter(step => matcher.position(step) === null);
        expect(collectPipelineIssues(jobs), `${jobId} without ${matcher.label}`).toContain(
          `${jobId}: missing step ${matcher.label}.`
        );
      }
      const jobs = ciJobs();
      const first = locate(jobs[jobId], matchers[0])![0];
      const last = locate(jobs[jobId], matchers.at(-1)!)![0];
      const steps = jobs[jobId].steps;
      [steps[first], steps[last]] = [steps[last], steps[first]];
      expect(collectPipelineIssues(jobs).some(issue => issue.startsWith(`${jobId}:`))).toBe(true);
    }
  });

  it('keeps provenance, telemetry and post-merge evidence in their owning jobs', () => {
    const jobs = ciJobs();
    jobs['unit-risk'].steps.push({ run: 'npm run report:ci-runtime-observed-profile' });
    expect(collectPipelineIssues(jobs)).toContain(
      '"npm run report:ci-runtime-observed-profile" must run only in ci-runtime-telemetry; found ci-runtime-telemetry, unit-risk.'
    );
  });

  it('waits for the producers it reads and runs post-merge evidence only on main pushes', () => {
    const jobs = ciJobs();
    expect(jobNeeds(jobs['final-confidence-and-readiness']).sort()).toEqual(
      [
        'build',
        'e2e-critical-emulator',
        'preview-smoke',
        'quality-static-governance-snapshots',
      ].sort()
    );
    const postmerge = jobs['postmerge-evidence'];
    expect(postmerge.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(jobNeeds(postmerge)).toEqual(
      expect.arrayContaining([
        'build',
        'preview-smoke',
        'ci-strict-summary',
        'e2e-critical-emulator',
      ])
    );
    expect(postmerge.permissions).toMatchObject({ actions: 'read' });
    // The final upload carries the provenance and flow evidence it validated.
    const canonical = jobs['final-confidence-and-readiness'].steps.find(
      step => step.with?.name === 'confidence-and-readiness'
    );
    expect(String(canonical?.with?.path)).toContain(
      'reports/e2e/preview-bootstrap/ci-provenance.json'
    );
    expect(String(canonical?.with?.path)).toContain(
      'reports/e2e/flow-performance-budget-summary.json'
    );
    expect(
      Object.entries(jobs).filter(([, job]) =>
        job.steps.some(step => step.with?.name === 'confidence-and-readiness')
      )
    ).toHaveLength(1);
    expect(jobs['ci-strict-summary'].permissions).toEqual({});
    expect(
      jobs['ci-strict-summary'].steps.some(step => step.uses?.includes('upload-artifact'))
    ).toBe(false);
  });

  it('collects GitHub Actions runtime after the gates it measures, with an explicit token', () => {
    const telemetry = ciJobs()['ci-runtime-telemetry'];
    assertTelemetryAccess(telemetry);
    const collect = telemetry.steps.find(step =>
      step.run?.includes('npm run collect:ci-runtime-observed-input')
    );
    expect(collect?.env).toMatchObject({
      CI_RUNTIME_COLLECTION_REQUIRED: '1',
      GITHUB_TOKEN: '${{ github.token }}',
    });
  });

  it('rejects consuming an artifact without waiting for the job that produces it', () => {
    const consumerWithoutNeeds = `
jobs:
  producer:
    steps:
      - name: Upload evidence
        uses: actions/upload-artifact@v7
        with:
          name: evidence
          path: reports/evidence.json
  consumer:
    needs: [unrelated]
    steps:
      - name: Download evidence
        uses: actions/download-artifact@v7
        with:
          name: evidence
          path: reports
  unrelated:
    steps:
      - run: echo unrelated
`;
    expect(collectCiArtifactContractIssues(consumerWithoutNeeds)).toContainEqual(
      expect.stringContaining(
        'consumer: downloads artifact "evidence" before declaring a needs chain'
      )
    );
  });
});

describe('Workflow runtime conventions', () => {
  const workflows = fs
    .readdirSync(path.join(process.cwd(), '.github', 'workflows'))
    .filter(file => /\.ya?ml$/.test(file))
    .map(file => ({ file, workflow: parse(readWorkflowText(file)) }));
  const stepsOf = (workflow: { jobs: Record<string, Partial<WorkflowJob>> }) =>
    Object.values(workflow.jobs).flatMap(job => job.steps ?? []);

  it('opts every workflow into Node 24 actions and avoids deprecated Node 20 majors', () => {
    const deprecated = [
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/upload-artifact@v4',
    ];
    for (const { file, workflow } of workflows) {
      expect(workflow.env?.FORCE_JAVASCRIPT_ACTIONS_TO_NODE24, file).toBe(true);
      for (const step of stepsOf(workflow))
        expect(deprecated, `${file}: ${step.uses}`).not.toContain(step.uses);
    }
  });

  it('keeps long clinical and runtime suites in the scheduled nightly workflow', () => {
    const nightly = parse(readWorkflowText('nightly-test-runtime.yml'));
    expect(Object.keys(nightly.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const runs = stepsOf(nightly).map(step => step.run ?? '');
    for (const command of [
      'npm run test:sync-load',
      'npm run test:release-confidence:full',
      'npm run test:e2e:clinical-stability:ci',
    ])
      expect(
        runs.some(text => text.includes(command)),
        command
      ).toBe(true);
    expect(stepsOf(nightly).some(step => step.with?.name === 'test-runtime-governance')).toBe(true);
  });

  it('runs the dependency audit when its own scripts change', () => {
    const audit = parse(readWorkflowText('security-audit.yml'));
    for (const trigger of ['pull_request', 'push'])
      expect(audit.on[trigger].paths, trigger).toEqual(
        expect.arrayContaining([
          'scripts/check-dependency-vulnerabilities.mjs',
          'scripts/lib/dependencyAuditSupport.mjs',
          '.github/workflows/security-audit.yml',
        ])
      );
  });

  it('keeps Firefox out of PR CI until it is a supported browser', () => {
    const jobs = ciJobs();
    expect(Object.keys(jobs)).not.toContain('e2e-firefox-compat');
    for (const step of Object.values(jobs).flatMap(job => job.steps)) {
      expect(step.run ?? '').not.toContain('playwright install --with-deps firefox');
      expect(step.env?.E2E_CRITICAL_BROWSERS).not.toBe('firefox');
    }
  });
});
