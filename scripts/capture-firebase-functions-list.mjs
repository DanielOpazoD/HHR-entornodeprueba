#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { captureFunctionsList } from './functionDeploymentSupport.mjs';

const [, , projectFlag, project, outputPath] = process.argv;
if (projectFlag !== '--project' || !/^[a-z0-9-]+$/.test(project || '') || !outputPath) {
  console.error('Usage: capture-firebase-functions-list.mjs --project <id> <functions-list.json>');
  process.exit(2);
}

try {
  const listing = await captureFunctionsList({
    run: () =>
      spawnSync(
        'npx',
        ['--no-install', 'firebase', 'functions:list', '--project', project, '--json'],
        {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        }
      ),
    sleep,
    log: message => console.error(`[firebase-deploy] ${message}`),
  });
  fs.writeFileSync(outputPath, listing);
  console.log(`[firebase-deploy] Captured deployed functions for ${project}.`);
} catch (error) {
  console.error(`[firebase-deploy] ${error.message}`);
  process.exitCode = 1;
}
