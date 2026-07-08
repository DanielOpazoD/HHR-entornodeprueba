#!/usr/bin/env node

import { evaluateSyncInvariants, formatSyncInvariantsReport } from './syncInvariantsSupport.mjs';

const result = evaluateSyncInvariants(process.cwd());
const output = formatSyncInvariantsReport(result);

if (!result.ok) {
  console.error(output);
  process.exit(1);
}

console.log(output.trim());
