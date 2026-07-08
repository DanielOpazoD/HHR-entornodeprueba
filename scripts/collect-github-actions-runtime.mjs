#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUTPUT_PATH = 'reports/ci-runtime-observed-input.json';
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGES = 20;

const normalizeRequiredFlag = value => ['1', 'true', 'yes', 'required'].includes(String(value || '').toLowerCase());

const resolveConfig = env => ({
  apiUrl: env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL,
  outputPath: env.CI_RUNTIME_OBSERVED_INPUT || DEFAULT_OUTPUT_PATH,
  repository: env.GITHUB_REPOSITORY || '',
  required: normalizeRequiredFlag(env.CI_RUNTIME_COLLECTION_REQUIRED),
  runId: env.GITHUB_RUN_ID || '',
  token: env.GITHUB_TOKEN || '',
});

const missingConfigKeys = config =>
  [
    ['GITHUB_TOKEN', config.token],
    ['GITHUB_REPOSITORY', config.repository],
    ['GITHUB_RUN_ID', config.runId],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

const encodeRepositoryPath = repository => repository.split('/').map(encodeURIComponent).join('/');

export const buildGithubActionsJobsUrl = ({ apiUrl, repository, runId, page, perPage = DEFAULT_PER_PAGE }) =>
  `${String(apiUrl || DEFAULT_GITHUB_API_URL).replace(/\/$/, '')}/repos/${encodeRepositoryPath(
    repository
  )}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=${perPage}&page=${page}`;

export const normalizeGithubActionsJob = job => ({
  completedAt: String(job?.completed_at || job?.completedAt || ''),
  conclusion: String(job?.conclusion || '').toUpperCase(),
  name: String(job?.name || ''),
  startedAt: String(job?.started_at || job?.startedAt || ''),
  status: String(job?.status || '').toUpperCase(),
});

const buildRuntimeInput = ({ config, error, jobs, sourceStatus }) => ({
  generatedAt: new Date().toISOString(),
  jobs,
  source: {
    ...(error ? { error: String(error) } : {}),
    provider: 'github-actions',
    repository: config.repository || null,
    runId: config.runId || null,
    status: sourceStatus,
  },
});

const writeRuntimeInput = ({ root, outputPath, payload }) => {
  const filePath = path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
};

const fetchGithubActionsJobs = async ({ config, fetchImpl }) => {
  const jobs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(
        buildGithubActionsJobsUrl({
          apiUrl: config.apiUrl,
          repository: config.repository,
          runId: config.runId,
          page,
        }),
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${config.token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        throw new Error(`GitHub Actions jobs request failed: ${response.status} ${response.statusText}`);
      }
      const body = await response.json();
      const pageJobs = Array.isArray(body?.jobs) ? body.jobs : [];
      if (pageJobs.length === 0) break;
      jobs.push(...pageJobs);
    } finally {
      clearTimeout(timeout);
    }
  }
  return jobs.map(normalizeGithubActionsJob).filter(job => job.name);
};

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 *   outputPath?: string,
 *   required?: boolean,
 *   root?: string,
 * }} [options]
 */
export const collectGithubActionsRuntimeInput = async ({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outputPath,
  required,
  root = process.cwd(),
} = {}) => {
  const config = {
    ...resolveConfig(env),
    outputPath: outputPath || resolveConfig(env).outputPath,
  };
  config.required = typeof required === 'boolean' ? required : config.required;

  const missingKeys = missingConfigKeys(config);
  if (missingKeys.length > 0) {
    if (config.required) {
      throw new Error(`Missing GitHub Actions runtime configuration: ${missingKeys.join(', ')}`);
    }
    const payload = buildRuntimeInput({
      config,
      jobs: [],
      sourceStatus: 'missing_configuration',
    });
    writeRuntimeInput({ root, outputPath: config.outputPath, payload });
    return payload;
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('GitHub Actions runtime collection requires a fetch implementation.');
  }

  let jobs;
  try {
    jobs = await fetchGithubActionsJobs({ config, fetchImpl });
  } catch (error) {
    const payload = buildRuntimeInput({
      config,
      error: error instanceof Error ? error.message : String(error),
      jobs: [],
      sourceStatus: 'collection_failed',
    });
    writeRuntimeInput({ root, outputPath: config.outputPath, payload });
    return payload;
  }
  const payload = buildRuntimeInput({
    config,
    jobs,
    sourceStatus: 'collected',
  });
  writeRuntimeInput({ root, outputPath: config.outputPath, payload });
  return payload;
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  collectGithubActionsRuntimeInput()
    .then(payload => {
      console.log(
        `[ci-runtime-collector] ${payload.source.status}; wrote ${payload.jobs.length} job(s) to ${
          process.env.CI_RUNTIME_OBSERVED_INPUT || DEFAULT_OUTPUT_PATH
        }`
      );
    })
    .catch(error => {
      console.error(`[ci-runtime-collector] ${error.message}`);
      process.exit(1);
    });
}
