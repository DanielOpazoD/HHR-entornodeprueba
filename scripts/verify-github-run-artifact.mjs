#!/usr/bin/env node

const readArgValue = (flag, fallback = '') => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
};

const expectedArtifact = readArgValue('--artifact', process.env.EXPECTED_ARTIFACT || 'dist');
const producerJob = readArgValue(
  '--producer',
  process.env.EXPECTED_ARTIFACT_PRODUCER || 'build-budget'
);
const artifactApiTimeoutMs = Number.parseInt(
  readArgValue('--timeout-ms', process.env.GITHUB_ARTIFACT_API_TIMEOUT_MS || '15000'),
  10
);

const {
  GITHUB_API_URL = 'https://api.github.com',
  GITHUB_REPOSITORY: repository,
  GITHUB_RUN_ID: runId,
  GITHUB_RUN_ATTEMPT: runAttempt = '1',
  GITHUB_SHA: commit,
  GITHUB_WORKFLOW: workflow,
  GITHUB_SERVER_URL = 'https://github.com',
  GITHUB_TOKEN: token,
} = process.env;

class ArtifactVerificationFailure extends Error {}

const fail = message => {
  console.error(`[postmerge-evidence] ${message}`);
  console.error(`[postmerge-evidence] expectedArtifact=${expectedArtifact}`);
  console.error(`[postmerge-evidence] expectedProducer=${producerJob}`);
  console.error(`[postmerge-evidence] workflow=${workflow || 'unknown'}`);
  console.error(`[postmerge-evidence] run=${runId || 'unknown'} attempt=${runAttempt}`);
  console.error(`[postmerge-evidence] commit=${commit || 'unknown'}`);
  if (repository && runId) {
    console.error(
      `[postmerge-evidence] runUrl=${GITHUB_SERVER_URL}/${repository}/actions/runs/${runId}`
    );
  }
  process.exitCode = 1;
  throw new ArtifactVerificationFailure(message);
};

const verifyArtifactAvailability = async () => {
  if (!repository || !runId || !token) {
    fail('Cannot verify artifact availability because GitHub Actions context is incomplete.');
  }

  let response;
  try {
    response = await fetch(
      `${GITHUB_API_URL}/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(
          Number.isFinite(artifactApiTimeoutMs) ? artifactApiTimeoutMs : 15000
        ),
      }
    );
  } catch (error) {
    fail(
      `GitHub artifact API request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    fail(`GitHub artifact API returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  // The run-artifacts API is name-scoped and does not expose the producing job;
  // producerJob is logged as the expected contract source for diagnostics.
  const artifact = artifacts.find(candidate => candidate?.name === expectedArtifact);

  if (!artifact) {
    const available = artifacts.map(candidate => candidate.name).filter(Boolean);
    fail(
      `Required artifact was not uploaded before post-merge evidence. Available artifacts: ${
        available.length > 0 ? available.join(', ') : 'none'
      }.`
    );
  }

  if (artifact.expired) {
    fail(`Required artifact "${expectedArtifact}" exists but is expired.`);
  }

  console.log(
    `[postmerge-evidence] Artifact "${expectedArtifact}" is available for run ${runId} (id=${artifact.id}).`
  );
};

try {
  await verifyArtifactAvailability();
} catch (error) {
  if (error instanceof ArtifactVerificationFailure) {
    process.exitCode = 1;
  } else {
    throw error;
  }
}
