#!/usr/bin/env node

import { evaluateDailyRecordAuthorityReleaseGate } from './dailyRecordAuthorityReleaseGateSupport.mjs';

const result = evaluateDailyRecordAuthorityReleaseGate(process.env);

if (!result.ok) {
  console.error(`[daily-record-authority-release-gate] ${result.message}`);
  console.error(`[daily-record-authority-release-gate] resolvedMode=${result.mode}`);
  process.exit(1);
}

console.log(`[daily-record-authority-release-gate] OK (${result.message})`);
