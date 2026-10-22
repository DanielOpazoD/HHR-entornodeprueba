export const FUNCTION_DEPLOYMENT_FILES = new Set([
  'firebase.json',
  'package.json',
  'package-lock.json',
  'scripts/build-cudyr-source-parser.mjs',
  'src/services/cudyr/cudyrSourceServerEntry.ts',
  'src/services/cudyr/cudyrSupplementBinary.ts',
  'src/services/cudyr/cudyrSupplementParser.ts',
  'src/services/cudyr/cudyrCensusParser.ts',
  '.github/workflows/deploy-functions.yml',
  'scripts/check-deployed-firebase-functions.mjs',
  'scripts/check-firebase-function-regions.mjs',
  'scripts/check-firebase-function-delete-result.mjs',
  'scripts/list-firebase-function-targets.mjs',
  'scripts/check-function-deployment-ci.mjs',
  'scripts/functionDeploymentSupport.mjs',
  'scripts/capture-firebase-functions-list.mjs',
]);

/** Name GitHub gives the reusable deploy job inside the main CI run. */
export const FUNCTION_DEPLOY_JOB_NAME =
  'validated-functions-deployment / deploy-firebase-functions';
const COMMIT_SHA = /^[a-f0-9]{40}$/;

export const affectsFunctionDeployment = file =>
  file.startsWith('functions/') || FUNCTION_DEPLOYMENT_FILES.has(file);

export const deploymentChangedFiles = (git, from, to) =>
  git(['diff', '--no-renames', '--name-only', '-z', from, to]).split('\0').filter(Boolean);

export const deploymentSourceChanged = (git, before, sha) => {
  try {
    git(['cat-file', '-e', `${before}^{commit}`]);
  } catch {
    // Missing history must not silently omit a deploy of validated Functions.
    return true;
  }
  return deploymentChangedFiles(git, before, sha).some(affectsFunctionDeployment);
};

const FAILED_DEPLOY_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

/**
 * Walks main CI runs from newest to oldest until a Functions deployment
 * succeeded in its latest attempt. `unsettled` records a failed, cancelled or
 * timed-out deployment newer than that success: it may have left its code (or
 * a mix of versions) live, so an identical source tree does not prove the
 * environment matches. In-flight runs are inspected too; only final job
 * conclusions count. `lastSuccessSha` is null when no success is in the window.
 */
export const findDeploymentBaseline = async ({ repository, api, maxRuns = 50 }) => {
  const payload = await api(
    `/repos/${repository}/actions/workflows/ci-cd.yml/runs?branch=main&event=push&per_page=${maxRuns}`
  );
  const runs = (payload.workflow_runs || []).sort((a, b) => b.id - a.id);
  let unsettled = false;
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || !COMMIT_SHA.test(run.head_sha || '')) continue;
    const jobs = await api(
      `/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`
    );
    const deploy = (jobs.jobs || []).find(job => job.name === FUNCTION_DEPLOY_JOB_NAME);
    if (deploy?.conclusion === 'success') return { lastSuccessSha: run.head_sha, unsettled };
    if (FAILED_DEPLOY_CONCLUSIONS.has(deploy?.conclusion)) unsettled = true;
  }
  return { lastSuccessSha: null, unsettled };
};

/**
 * A push deploys when its own diff touches Functions, and also when the
 * environment may not match it: a deployment attempt failed after the last
 * success, or Functions changed since that success. `baseline` undefined means
 * the lookup was unavailable: keep the push-only decision so a GitHub outage
 * never deploys less than before.
 */
export const resolveDeploymentScope = ({ git, before, sha, baseline }) => {
  if (/^0+$/.test(before)) return { changed: true, reason: 'new-branch' };
  if (deploymentSourceChanged(git, before, sha)) return { changed: true, reason: 'push-diff' };
  if (baseline === undefined) return { changed: false, reason: 'lookup-unavailable' };
  if (baseline.unsettled) return { changed: true, reason: 'unsettled-attempt' };
  if (baseline.lastSuccessSha === null) return { changed: true, reason: 'no-recent-success' };
  if (deploymentSourceChanged(git, baseline.lastSuccessSha, sha))
    return { changed: true, reason: 'since-last-success' };
  return { changed: false, reason: 'unchanged' };
};

/**
 * The serialized preflight runs after any earlier deployment finished. A push
 * whose Functions sources were already deployed successfully, with no failed
 * attempt since, has nothing left to roll out.
 */
export const alreadyDeployed = ({ git, sha, baseline }) =>
  Boolean(
    baseline &&
    !baseline.unsettled &&
    baseline.lastSuccessSha &&
    !deploymentSourceChanged(git, baseline.lastSuccessSha, sha)
  );

const describeListFailure = ({ status, stdout, stderr, error, signal }) => {
  if (error || status === null)
    return `spawn ${error?.code || 'error'}${signal ? ` signal ${signal}` : ''}`;
  try {
    const payload = JSON.parse(stdout);
    if (status === 0 && payload?.status === 'success' && Array.isArray(payload.result)) return null;
    const message = payload?.error?.message ?? payload?.error ?? payload?.status;
    return `exit ${status}; ${String(message || 'unexpected payload')}`;
  } catch {
    return `exit ${status}; ${String(stderr || stdout || 'no output').trim()}`;
  }
};

/**
 * Runs `firebase functions:list --json` with bounded retries. The CLI writes
 * its error into the JSON payload, so print it instead of hiding it in a file.
 */
export const captureFunctionsList = async ({ run, sleep, delaysMs = [30000, 60000], log }) => {
  const attempts = delaysMs.length + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run();
    const failure = describeListFailure(result);
    if (!failure) return result.stdout;
    log(`functions:list attempt ${attempt}/${attempts} failed: ${failure.slice(0, 400)}`);
    if (attempt < attempts) await sleep(delaysMs[attempt - 1]);
  }
  throw new Error(`functions:list failed after ${attempts} attempts.`);
};

export const verifyFunctionDeploymentCi = async ({ repository, sha, event, runId, api }) => {
  let run;
  if (event === 'push') {
    run = await api(`/repos/${repository}/actions/runs/${runId}`);
  } else if (event === 'workflow_dispatch') {
    const payload = await api(
      `/repos/${repository}/actions/workflows/ci-cd.yml/runs?branch=main&event=push&per_page=100`
    );
    run = (payload.workflow_runs || [])
      .filter(candidate => candidate.head_sha === sha)
      .sort((a, b) => b.id - a.id)[0];
  } else {
    throw new Error('Functions deployment requires a validated main push or a manual main retry.');
  }
  if (
    !run ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_sha !== sha ||
    run.path?.split('@')[0] !== '.github/workflows/ci-cd.yml' ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.run_attempt)
  ) {
    throw new Error('No matching main CI run for this exact revision.');
  }
  const payload = await api(
    `/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
  );
  const summaries = (payload.jobs || []).filter(job => job.name === 'ci-summary');
  if (summaries.length !== 1 || summaries[0].conclusion !== 'success') {
    throw new Error('The exact revision has not passed ci-summary in its latest CI attempt.');
  }
  return run.id;
};
