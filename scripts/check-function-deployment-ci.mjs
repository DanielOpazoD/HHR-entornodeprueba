#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  affectsFunctionDeployment,
  deploymentChangedFiles,
  deploymentSourceChanged,
  verifyFunctionDeploymentCi,
} from './functionDeploymentSupport.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = process.env.GITHUB_SHA;
const event = process.env.GITHUB_EVENT_NAME;
const changedFiles = (from, to) => deploymentChangedFiles(git, from, to);
const output = (name, value) => {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

try {
  if (
    !/^[a-f0-9]{40}$/.test(sha || '') ||
    git(['rev-parse', 'HEAD']) !== sha ||
    process.env.GITHUB_REF !== 'refs/heads/main'
  ) {
    throw new Error('Checkout must match the immutable main revision.');
  }
  if (process.argv[2] === '--scope') {
    if (event !== 'push') throw new Error('Automatic scope is only supported for main pushes.');
    const before = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).before;
    if (!/^[a-f0-9]{40}$/.test(before || '')) throw new Error('Invalid push base revision.');
    const changed = /^0+$/.test(before) || deploymentSourceChanged(git, before, sha);
    output('changed', changed);
    console.log(`[functions-deployment] Relevant source changes: ${changed}`);
  } else if (process.argv[2] === '--guard') {
    const repository = process.env.GITHUB_REPOSITORY;
    const runId = process.env.GITHUB_RUN_ID;
    const token = process.env.GITHUB_TOKEN;
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repository || '') ||
      !/^\d+$/.test(runId || '') ||
      !token ||
      (process.env.GITHUB_API_URL && process.env.GITHUB_API_URL !== 'https://api.github.com')
    ) {
      throw new Error('GitHub verification context is incomplete.');
    }
    const api = async route => {
      const response = await fetch(`https://api.github.com${route}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`GitHub verification failed with HTTP ${response.status}.`);
      return response.json();
    };
    const verifiedRun = await verifyFunctionDeploymentCi({ repository, sha, event, runId, api });
    const remote = git(['remote', 'get-url', 'origin']);
    if (
      ![`https://github.com/${repository}`, `https://github.com/${repository}.git`].includes(remote)
    )
      throw new Error('Git source must belong to the verified GitHub repository.');
    // Authenticate only this fetch, without persisting a credential or putting
    // it in process arguments. Preserve any existing Git configuration entries.
    const configCount = Number(process.env.GIT_CONFIG_COUNT || 0);
    if (!Number.isSafeInteger(configCount) || configCount < 0)
      throw new Error('Invalid Git configuration context.');
    try {
      execFileSync('git', ['fetch', '--no-tags', 'origin', 'main'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: String(configCount + 1),
          [`GIT_CONFIG_KEY_${configCount}`]: 'http.https://github.com/.extraheader',
          [`GIT_CONFIG_VALUE_${configCount}`]: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        },
      });
    } catch {
      throw new Error('Authenticated GitHub source refresh failed.');
    }
    // An older frontend-only revision can still carry identical Functions. Never
    // overwrite a newer Functions revision that arrived while CI was running.
    const stale = changedFiles(sha, 'origin/main').some(affectsFunctionDeployment);
    output('eligible', !stale);
    console.log(
      `[functions-deployment] CI run ${verifiedRun} verified; deploy eligible: ${!stale}`
    );
  } else {
    throw new Error('Expected --scope or --guard.');
  }
} catch (error) {
  console.error(`[functions-deployment] ${error.message}`);
  process.exitCode = 1;
}
