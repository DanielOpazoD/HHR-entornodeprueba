#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCiChangeScope,
  collectChangedFilesFromGit,
  loadCiChangeScopeConfig,
} from './ciChangeScopeSupport.mjs';

const writeOutput = result => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `scope=${result.scope}\nreason=${result.reason}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

export const main = async ({ env = process.env, root = process.cwd() } = {}) => {
  const eventName = env.GITHUB_EVENT_NAME || '';
  if (eventName !== 'pull_request') {
    const result = classifyCiChangeScope({ eventName, files: [], config: loadCiChangeScopeConfig(root) });
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
    process.stderr.write(`CI change scope fell back to full: ${error instanceof Error ? error.message : error}\n`);
    writeOutput(result);
    return result;
  }
};

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) await main();
