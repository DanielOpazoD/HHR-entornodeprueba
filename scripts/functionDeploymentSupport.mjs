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
]);

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
