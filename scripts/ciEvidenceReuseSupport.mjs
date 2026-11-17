/**
 * Decides whether a push to main may take its CI evidence from the pull request
 * run that already tested the same source tree, instead of repeating it.
 *
 * Every pull request run records the commit GitHub tested (refs/pull/N/merge)
 * and its tree in an artifact name. Main reuses a run only when that tree is
 * main's tree and the run is complete and green: the run succeeded in its
 * latest attempt, every gate ci-summary requires succeeded, no job failed, and
 * the artifacts postmerge-evidence reads are still available. Anything else,
 * including a lookup error, runs the full pipeline.
 */

const SHA = /^[0-9a-f]{40}$/;
const TESTED_ARTIFACT = /^pr-tested-([0-9a-f]{40})-([0-9a-f]{40})$/;
const WORKFLOW_PATH = '.github/workflows/ci-cd.yml';

/** Name of the artifact a pull request run uploads to declare what it tested. */
export const testedArtifactName = ({ commit, tree }) => `pr-tested-${commit}-${tree}`;

/** Full-scope gates ci-summary requires, by job name (kept equal by a workflow test). */
export const REQUIRED_PR_JOBS = [
  'ci-summary',
  'quality-static',
  'unit-risk',
  'clinical-sync-release-gate',
  'rules-emulator',
  'emulator-ui',
  'e2e-critical lane 1',
  'e2e-critical lane 2',
  'e2e-critical lane 3',
  'build-budget',
  'preview-smoke-lane (app)',
  'preview-smoke-lane (dicom-graphics-stress)',
  'preview-smoke-lane (dicom-1)',
  'preview-smoke-lane (dicom-2)',
  'preview-smoke-lane (dicom-3)',
  'final-confidence-and-readiness',
  'ci-runtime-telemetry',
  'census-startup-performance (development)',
  'census-startup-performance (production)',
];

/** Artifacts postmerge-evidence downloads from the run whose evidence main reuses. */
export const REUSED_EVIDENCE_ARTIFACTS = [
  'dist',
  'preview-bootstrap-artifacts',
  'critical-coverage',
  'release-evidence-runtime',
  'flow-performance-evidence',
];

const ACCEPTED_JOB_CONCLUSIONS = new Set(['success', 'skipped']);

const rejectRunMetadata = ({ repository, run }) => {
  if (
    run.event !== 'pull_request' ||
    run.path?.split('@')[0] !== WORKFLOW_PATH ||
    run.head_repository?.full_name !== repository ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1
  )
    return 'not_a_pull_request_run_of_this_workflow';
  if (run.status !== 'completed' || run.conclusion !== 'success') return 'run_not_green';
  return null;
};

/**
 * Why `run` cannot lend its evidence to main's tree, or the commit and tree it
 * tested when it can.
 */
export const rejectRun = ({ repository, mainTree, run, artifacts, jobs }) => {
  const metadataRejection = rejectRunMetadata({ repository, run });
  if (metadataRejection) return metadataRejection;

  const artifactList = artifacts?.artifacts ?? [];
  if (artifacts?.total_count !== artifactList.length) return 'artifact_list_incomplete';
  const tested = new Set(
    artifactList.map(artifact => TESTED_ARTIFACT.exec(artifact.name)?.slice(1).join(' '))
  );
  tested.delete(undefined);
  if (tested.size !== 1) return 'tested_tree_unrecorded';
  const [commit, tree] = [...tested][0].split(' ');
  if (tree !== mainTree) return 'tree_mismatch';
  const available = new Set(artifactList.filter(a => !a.expired).map(a => a.name));
  if (REUSED_EVIDENCE_ARTIFACTS.some(name => !available.has(name))) return 'evidence_expired';

  const jobList = jobs?.jobs ?? [];
  if (jobs?.total_count !== jobList.length) return 'job_list_incomplete';
  if (jobList.some(job => !ACCEPTED_JOB_CONCLUSIONS.has(job.conclusion))) return 'job_not_green';
  const passed = new Set(jobList.filter(job => job.conclusion === 'success').map(job => job.name));
  if (REQUIRED_PR_JOBS.some(name => !passed.has(name))) return 'run_not_complete';

  return { commit, tree };
};

/**
 * Looks for the newest reusable run of the pull request merged as `sha`.
 * `api(route)` returns parsed JSON from the GitHub REST API.
 */
export const findReusableEvidence = async ({ repository, sha, mainTree, api }) => {
  if (!SHA.test(sha) || !SHA.test(mainTree)) return { reason: 'invalid_main_revision' };
  const pulls = (await api(`/repos/${repository}/commits/${sha}/pulls`)).filter(
    pull => pull.merged_at && pull.merge_commit_sha === sha && pull.base?.ref === 'main'
  );
  if (pulls.length === 0) return { reason: 'no_merged_pull_request' };

  let reason = 'no_pull_request_run';
  for (const pull of pulls) {
    if (!SHA.test(pull.head?.sha || '')) continue;
    const { workflow_runs: runs = [] } = await api(
      `/repos/${repository}/actions/workflows/ci-cd.yml/runs?event=pull_request&head_sha=${pull.head.sha}&per_page=20`
    );
    for (const run of [...runs].sort((a, b) => b.id - a.id)) {
      if (run.head_sha !== pull.head.sha) continue;
      const metadataRejection = rejectRunMetadata({ repository, run });
      if (metadataRejection) {
        reason = metadataRejection;
        continue;
      }
      const base = `/repos/${repository}/actions/runs/${run.id}`;
      const artifacts = await api(`${base}/artifacts?per_page=100`);
      const jobs = await api(`${base}/jobs?filter=latest&per_page=100`);
      const verdict = rejectRun({ repository, mainTree, run, artifacts, jobs });
      if (typeof verdict === 'string') {
        reason = verdict;
        continue;
      }
      // The attempt bounds the attempts of the producers postmerge-evidence validates.
      return { runId: run.id, runAttempt: run.run_attempt, pullRequest: pull.number, ...verdict };
    }
  }
  return { reason };
};

/** Scope result for a push to main: `reused` with its evidence, or `full`. */
export const decideMainScope = async ({ repository, sha, mainTree, api }) => {
  try {
    const evidence = await findReusableEvidence({ repository, sha, mainTree, api });
    if (!evidence.runId) return { scope: 'full', reason: evidence.reason, usedFallback: true };
    return {
      scope: 'reused',
      reason: 'identical_tree_pull_request_run',
      usedFallback: false,
      evidence,
    };
  } catch (error) {
    return {
      scope: 'full',
      reason: 'evidence_lookup_failed',
      usedFallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * What did not run as it should among the jobs that exist only on a push to
 * main, given the workflow `needs` context ({ job: { result, outputs } }).
 *
 * GitHub skips a job without a status function when any ancestor was skipped,
 * and a reused main push skips every gate, so one of these jobs can stay
 * skipped while the run turns green (run 44155642457 never ran
 * function-deploy-scope). When ci-summary did not pass the run is already red
 * and none of these jobs is due, so nothing is reported.
 */
/**
 * A deployment the scope asked for must reach its preflight, whose decision the
 * reusable workflow returns as `eligible`. Not eligible (a newer Functions
 * revision on main, or the same sources already deployed) skips the deploy on
 * purpose, so only an eligible preflight requires the call to succeed.
 */
const deploymentViolations = deploy => {
  const result = deploy?.result ?? 'unavailable';
  const eligible = deploy?.outputs?.eligible;
  if (result === 'failure' || result === 'cancelled')
    return [`deploy-functions: ${result}, expected success`];
  if (eligible !== 'true' && eligible !== 'false')
    return [
      `deploy-functions: ${result} and its preflight decided nothing (eligible ${eligible || 'missing'})`,
    ];
  if (eligible === 'true' && result !== 'success')
    return [`deploy-functions: ${result}, expected success for an eligible deployment`];
  return [];
};

/** Jobs of ci-cd.yml that run only on a push to main (kept equal by a workflow test). */
export const MAIN_ONLY_JOBS = ['function-deploy-scope', 'deploy-functions', 'postmerge-evidence'];

export const mainOnlyJobViolations = needs => {
  const summary = needs?.['ci-strict-summary']?.result;
  if (summary === undefined) return ['ci-summary: result unavailable'];
  if (summary !== 'success') return [];

  const violations = [];
  const expect = (job, expected) => {
    const result = needs[job]?.result ?? 'unavailable';
    if (result !== expected) violations.push(`${job}: ${result}, expected ${expected}`);
  };
  expect('postmerge-evidence', 'success');
  expect('function-deploy-scope', 'success');
  if (needs['function-deploy-scope']?.result === 'success') {
    const changed = needs['function-deploy-scope'].outputs?.changed;
    if (changed === 'true') violations.push(...deploymentViolations(needs['deploy-functions']));
    else if (changed === 'false') expect('deploy-functions', 'skipped');
    else violations.push(`function-deploy-scope: output changed is ${changed ?? 'missing'}`);
  }
  return violations;
};
