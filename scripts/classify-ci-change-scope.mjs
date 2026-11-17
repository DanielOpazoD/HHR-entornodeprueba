#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  classifyCiChangeScope,
  collectChangedFilesFromGit,
  loadCiChangeScopeConfig,
} from './ciChangeScopeSupport.mjs';
import { decideMainScope } from './ciEvidenceReuseSupport.mjs';

const writeOutput = result => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const { runId = '', runAttempt = '', commit = '', tree = '' } = result.evidence ?? {};
    fs.appendFileSync(
      outputPath,
      `scope=${result.scope}\nreason=${result.reason}\n` +
        `evidence_run_id=${runId}\nevidence_run_attempt=${runAttempt}\n` +
        `evidence_commit=${commit}\nevidence_tree=${tree}\n`,
      'utf8'
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const githubApi = env => async route => {
  const response = await fetch(`https://api.github.com${route}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub API ${route} answered HTTP ${response.status}.`);
  return response.json();
};

// The trusted checkout of a main push is the pushed commit itself.
const mainRevision = root => {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  return { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
};

export const main = async ({
  env = process.env,
  root = process.cwd(),
  api = githubApi(env),
  revision = mainRevision,
} = {}) => {
  const eventName = env.GITHUB_EVENT_NAME || '';
  if (eventName === 'push' && env.GITHUB_REF === 'refs/heads/main') {
    let result;
    try {
      const { sha, tree } = revision(root);
      if (sha !== env.GITHUB_SHA) throw new Error('Checkout does not match the pushed commit.');
      result = await decideMainScope({
        repository: env.GITHUB_REPOSITORY,
        sha,
        mainTree: tree,
        api,
      });
    } catch (error) {
      result = { scope: 'full', reason: 'evidence_lookup_failed', usedFallback: true };
      process.stderr.write(`Main evidence reuse fell back to full: ${error.message}\n`);
    }
    writeOutput(result);
    return result;
  }
  if (eventName !== 'pull_request') {
    const result = classifyCiChangeScope({
      eventName,
      files: [],
      config: loadCiChangeScopeConfig(root),
    });
    writeOutput(result);
    return result;
  }

  try {
    const config = loadCiChangeScopeConfig(root);
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const files = collectChangedFilesFromGit({
      root: env.CI_GIT_ROOT,
      baseSha: event?.pull_request?.base?.sha,
      headSha: event?.pull_request?.head?.sha,
    });
    const result = classifyCiChangeScope({
      eventName,
      files,
      config,
    });
    writeOutput(result);
    return result;
  } catch (error) {
    const result = { scope: 'full', reason: 'classification_error', usedFallback: true };
    process.stderr.write(
      `CI change scope fell back to full: ${error instanceof Error ? error.message : error}\n`
    );
    writeOutput(result);
    return result;
  }
};

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) await main();
