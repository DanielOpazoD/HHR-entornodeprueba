#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const originalWarn = console.warn;
const originalError = console.error;

console.warn = () => {};
console.error = () => {};

let functionsIndex;

try {
  functionsIndex = require('../functions');
} finally {
  console.warn = originalWarn;
  console.error = originalError;
}

const targets = Object.keys(functionsIndex)
  .sort()
  .map(functionName => `functions:${functionName}`);

if (targets.length === 0) {
  console.error('[firebase-function-targets] No exported Firebase functions found.');
  process.exit(1);
}

console.log(targets.join(','));
