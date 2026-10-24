#!/usr/bin/env node

import fs from 'node:fs';
import { runVitestPack } from './vitestPackRunner.mjs';

const { scripts } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const packs = ['test:risk:auth', 'test:risk:admin-health', 'test:risk:platform'];

try {
  const files = packs.flatMap(name => {
    const command = scripts[name];
    if (typeof command !== 'string' || !command.startsWith('vitest run ')) {
      throw new Error(`${name} must select explicit files with vitest run`);
    }
    return command.slice('vitest run '.length).trim().split(/\s+/);
  });
  process.exitCode = runVitestPack(files);
} catch (error) {
  console.error(`[unit-critical] ${error.message}`);
  process.exitCode = 1;
}
