#!/usr/bin/env node
import process from 'node:process';
import {
  evaluateDailyRecordTruthContract,
  formatDailyRecordTruthContractReport,
} from './dailyRecordTruthContractSupport.mjs';

const result = evaluateDailyRecordTruthContract(process.cwd());
process.stdout.write(formatDailyRecordTruthContractReport(result));

if (!result.ok) {
  process.exitCode = 1;
}
