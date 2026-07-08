#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toCount = (value) => {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
};

const readJson = (reportPath) => {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return {
      __readError: error instanceof Error ? error.message : String(error),
    };
  }
};

export const collectPlaywrightReportIssues = (
  reportPath,
  { label = 'playwright report', requireAnyRecordedTest = true } = {}
) => {
  const issues = [];

  if (!fs.existsSync(reportPath)) {
    return [`${label} report is missing at ${reportPath}.`];
  }

  const report = readJson(reportPath);
  if (report.__readError) {
    return [`${label} report could not be parsed: ${report.__readError}`];
  }

  const stats = report.stats;
  if (!stats || typeof stats !== 'object') {
    return [`${label} report is missing Playwright stats.`];
  }

  const expected = toCount(stats.expected);
  const unexpected = toCount(stats.unexpected);
  const flaky = toCount(stats.flaky);
  const interrupted = toCount(stats.interrupted);
  const skipped = toCount(stats.skipped);

  if (unexpected > 0) {
    issues.push(`${label} has ${unexpected} unexpected failure(s).`);
  }

  if (flaky > 0) {
    issues.push(`${label} has ${flaky} flaky test(s); release evidence must be stable without retries.`);
  }

  if (interrupted > 0) {
    issues.push(`${label} has ${interrupted} interrupted test(s); release evidence is incomplete.`);
  }

  if (requireAnyRecordedTest && expected + unexpected + flaky + interrupted + skipped === 0) {
    issues.push(`${label} did not record any executed or skipped tests.`);
  }

  return issues;
};

const parseArgs = (argv) => {
  const args = [...argv];
  const reportPath = args.shift() ?? 'reports/e2e/playwright-report.json';
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1] : 'playwright report';
  return { reportPath, label };
};

const isMainModule = () => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule()) {
  const { reportPath, label } = parseArgs(process.argv.slice(2));
  const issues = collectPlaywrightReportIssues(reportPath, { label });

  if (issues.length > 0) {
    console.error(`Playwright report gate failed for ${label}:`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`${label} report is clean: no unexpected, flaky, or interrupted outcomes.`);
}
