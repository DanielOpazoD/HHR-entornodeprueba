#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { runVitestPack } from './vitestPackRunner.mjs';

const workspaceRoot = process.cwd();
const configPath = path.join(workspaceRoot, 'scripts/config/critical-smoke-pack.json');

if (!fs.existsSync(configPath)) {
  console.error('[critical-smoke-pack] Missing scripts/config/critical-smoke-pack.json');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const scenarios = Array.isArray(config.scenarios) ? config.scenarios : [];
const files = scenarios.map(scenario => scenario.file);

if (files.length === 0) {
  console.error('[critical-smoke-pack] No smoke scenarios configured');
  process.exit(1);
}

console.log('[critical-smoke-pack] Running scenarios:');
for (const scenario of scenarios) {
  console.log(`- ${scenario.id}: ${scenario.label} -> ${scenario.file}`);
}

try {
  process.exitCode = runVitestPack(files);
  if (process.exitCode === 0) {
    console.log('[critical-smoke-pack] All scenarios passed.');
  }
} catch (error) {
  console.error(`[critical-smoke-pack] ${error.message}`);
  process.exitCode = 1;
}
