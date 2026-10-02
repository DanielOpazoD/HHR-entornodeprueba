#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectPlaywrightReportIssues } from './check-playwright-report-clean.mjs';

const args = process.argv.slice(2);
const enforce = args.includes('--enforce');
const positional = args.filter(arg => !arg.startsWith('--'));

const defaultInput = process.env.PLAYWRIGHT_JSON_OUTPUT || 'reports/e2e/playwright-report.json';
const inputPath = positional[0] || defaultInput;
const outputJsonPath = positional[1] || 'reports/e2e/critical-operational-metrics.json';
const outputMarkdownPath = positional[2] || 'reports/e2e/critical-operational-summary.md';
const historyDirPath = positional[3] || process.env.E2E_HISTORY_DIR || 'reports/e2e/history';
const thresholdsPath =
  process.env.E2E_THRESHOLDS_CONFIG || 'scripts/config/e2e-operational-thresholds.json';
const baselinePath = process.env.E2E_BASELINE_METRICS_PATH || '';

const ensureDirFor = filePath => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const toSeconds = ms => Number((ms / 1000).toFixed(2));

const readJsonSafe = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const defaultThresholds = {
  maxFlaky: 0,
  maxRetriesUsed: 2,
  maxDurationMs: 480000,
  maxDurationRegressionPct: 20,
  historyWindow: 10,
};

const loadedThresholds = readJsonSafe(thresholdsPath) || {};
const thresholds = {
  ...defaultThresholds,
  ...loadedThresholds,
};

const nowIso = new Date().toISOString();
const evidenceIssues = collectPlaywrightReportIssues(inputPath, { label: 'critical E2E' });

const emptyMetrics = {
  generatedAt: nowIso,
  source: inputPath,
  reportFound: false,
  totalTests: 0,
  totalAttempts: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  timedOut: 0,
  interrupted: 0,
  flaky: 0,
  retriesUsed: 0,
  durationMs: 0,
  projects: Object.create(null),
  thresholds,
  baseline: null,
  status: 'warn',
  violations: [],
  warnings: ['Playwright JSON report not found; cannot compute E2E operational metrics.'],
};

const normalizeStatus = status => {
  if (!status) return 'unknown';
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'timedOut') return 'timedOut';
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'interrupted';
  return 'unknown';
};

const collectTests = (suite, acc) => {
  if (!suite || typeof suite !== 'object') return;

  const specs = Array.isArray(suite.specs) ? suite.specs : [];
  for (const spec of specs) {
    const tests = Array.isArray(spec.tests) ? spec.tests : [];
    for (const test of tests) {
      acc.push({
        test,
        file: spec.file || suite.file || 'unknown',
        title: spec.title || '',
        line: spec.line ?? null,
      });
    }
  }

  const nestedSuites = Array.isArray(suite.suites) ? suite.suites : [];
  for (const nested of nestedSuites) {
    collectTests(nested, acc);
  }
};

const computeBaselineFromHistory = historyDir => {
  if (!fs.existsSync(historyDir)) return null;

  const historyFiles = fs
    .readdirSync(historyDir)
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(historyDir, file))
    .map(filePath => ({
      filePath,
      payload: readJsonSafe(filePath),
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }))
    .filter(entry => entry.payload && entry.payload.reportFound)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, thresholds.historyWindow)
    .map(entry => entry.payload);

  if (historyFiles.length === 0) return null;

  const avg = (field, fallback = 0) => {
    const sum = historyFiles.reduce((acc, item) => acc + Number(item[field] || fallback), 0);
    return sum / historyFiles.length;
  };

  return {
    source: `history(${historyFiles.length})`,
    durationMs: Math.round(avg('durationMs')),
    flaky: Number(avg('flaky').toFixed(2)),
    retriesUsed: Number(avg('retriesUsed').toFixed(2)),
  };
};

const evaluateThresholds = metrics => {
  const violations = [...evidenceIssues];
  const warnings = [...metrics.warnings];

  if (!metrics.reportFound) {
    return {
      ...metrics,
      status: violations.length > 0 ? 'fail' : 'warn',
      violations,
      warnings,
    };
  }

  if (metrics.totalTests === 0) {
    violations.push('Critical E2E report has no test entries.');
  }
  if (metrics.failed + metrics.timedOut + metrics.interrupted > 0) {
    violations.push('Critical E2E report contains failed, timed out, or interrupted tests.');
  }

  if (metrics.flaky > thresholds.maxFlaky) {
    violations.push(`Flaky tests ${metrics.flaky} exceed maxFlaky ${thresholds.maxFlaky}.`);
  }

  if (metrics.retriesUsed > thresholds.maxRetriesUsed) {
    warnings.push(
      `Retries used ${metrics.retriesUsed} exceed advisory maxRetriesUsed ${thresholds.maxRetriesUsed}.`
    );
  }

  if (metrics.durationMs > thresholds.maxDurationMs) {
    warnings.push(
      `Duration ${toSeconds(metrics.durationMs)}s exceeds advisory maxDuration ${toSeconds(thresholds.maxDurationMs)}s.`
    );
  }

  if (metrics.baseline && metrics.baseline.durationMs > 0) {
    const deltaPct =
      ((metrics.durationMs - metrics.baseline.durationMs) / metrics.baseline.durationMs) * 100;
    metrics.durationRegressionPct = Number(deltaPct.toFixed(2));
    if (deltaPct > thresholds.maxDurationRegressionPct) {
      warnings.push(
        `Duration regression ${deltaPct.toFixed(2)}% exceeds advisory ${thresholds.maxDurationRegressionPct}% over baseline.`
      );
    }
  }

  const status = violations.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';

  return {
    ...metrics,
    status,
    violations,
    warnings,
  };
};

const writeOutputs = metrics => {
  ensureDirFor(outputJsonPath);
  fs.writeFileSync(outputJsonPath, JSON.stringify(metrics, null, 2));

  fs.mkdirSync(historyDirPath, { recursive: true });
  const historyFilePath = path.join(
    historyDirPath,
    `critical-operational-metrics-${metrics.generatedAt.replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(historyFilePath, JSON.stringify(metrics, null, 2));

  const lines = [
    '# E2E Operational Metrics',
    '',
    `- Generated: ${metrics.generatedAt}`,
    `- Source report: ${metrics.source}`,
    `- Status: ${String(metrics.status || 'unknown').toUpperCase()}`,
    `- Tests: ${metrics.totalTests}`,
    `- Attempts (incl. retries): ${metrics.totalAttempts}`,
    `- Flaky tests: ${metrics.flaky}`,
    `- Retries used: ${metrics.retriesUsed}`,
    `- Duration (sum of test attempts): ${toSeconds(metrics.durationMs)} s`,
    `- Playwright wall duration: ${metrics.wallDurationMs === null || metrics.wallDurationMs === undefined ? 'unavailable' : `${toSeconds(metrics.wallDurationMs)} s`}`,
    '',
    '## Thresholds',
    '',
    `- maxFlaky: ${thresholds.maxFlaky}`,
    `- maxRetriesUsed (advisory): ${thresholds.maxRetriesUsed}`,
    `- maxDurationMs (advisory): ${thresholds.maxDurationMs}`,
    `- maxDurationRegressionPct (advisory): ${thresholds.maxDurationRegressionPct}%`,
  ];

  if (metrics.baseline) {
    lines.push('', '## Baseline', '');
    lines.push(`- Source: ${metrics.baseline.source}`);
    lines.push(`- Avg duration: ${toSeconds(metrics.baseline.durationMs)} s`);
    lines.push(`- Avg flaky: ${metrics.baseline.flaky}`);
    lines.push(`- Avg retries: ${metrics.baseline.retriesUsed}`);
    if (typeof metrics.durationRegressionPct === 'number') {
      lines.push(`- Current duration regression: ${metrics.durationRegressionPct}%`);
    }
  }

  lines.push(
    '',
    '| Status | Count |',
    '| --- | ---: |',
    `| Passed | ${metrics.passed} |`,
    `| Failed | ${metrics.failed} |`,
    `| Timed out | ${metrics.timedOut} |`,
    `| Interrupted | ${metrics.interrupted} |`,
    `| Skipped | ${metrics.skipped} |`,
    '',
    '## Per Browser',
    '',
    '| Browser | Tests | Flaky | Retries | Duration (s) |',
    '| --- | ---: | ---: | ---: | ---: |'
  );

  for (const [project, info] of Object.entries(metrics.projects)) {
    lines.push(
      `| ${project} | ${info.tests} | ${info.flaky} | ${info.retriesUsed} | ${toSeconds(info.durationMs)} |`
    );
  }

  if (metrics.slowestTests?.length) {
    lines.push(
      '',
      '## Slowest tests (all attempts)',
      '',
      '| File | Test | Project | Attempts | Duration (s) |',
      '| --- | --- | --- | ---: | ---: |'
    );
    const cell = value =>
      String(value)
        .replace(/[\r\n]/g, ' ')
        .replace(/\|/g, '\\|');
    for (const test of metrics.slowestTests) {
      lines.push(
        `| ${cell(test.file)}:${test.line ?? '?'} | ${cell(test.title)} | ${cell(test.project)} | ${test.attempts} | ${toSeconds(test.durationMs)} |`
      );
    }
    lines.push(
      '',
      '## File costs (all attempts)',
      '',
      '| File | Tests | Attempts | Duration (s) |',
      '| --- | ---: | ---: | ---: |'
    );
    for (const [file, cost] of Object.entries(metrics.files).sort(
      (a, b) => b[1].durationMs - a[1].durationMs || a[0].localeCompare(b[0])
    )) {
      lines.push(
        `| ${cell(file)} | ${cost.tests} | ${cost.attempts} | ${toSeconds(cost.durationMs)} |`
      );
    }
  }

  if (metrics.violations.length > 0) {
    lines.push('', '## Violations', '');
    for (const violation of metrics.violations) {
      lines.push(`- ${violation}`);
    }
  }

  if (metrics.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of metrics.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  const markdown = lines.join('\n');
  ensureDirFor(outputMarkdownPath);
  fs.writeFileSync(outputMarkdownPath, `${markdown}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
  }
};

if (!fs.existsSync(inputPath)) {
  const finalMetrics = evaluateThresholds(emptyMetrics);
  writeOutputs(finalMetrics);
  console.warn('[e2e-metrics] Playwright JSON report not found. Wrote empty metrics artifact.');
  process.exit(enforce && finalMetrics.status === 'fail' ? 1 : 0);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const metrics = evaluateThresholds({
    ...emptyMetrics,
    warnings: [`Playwright JSON report could not be parsed: ${message}`],
  });
  writeOutputs(metrics);
  console.warn('[e2e-metrics] Invalid report JSON. Wrote empty metrics artifact.');
  process.exit(enforce && metrics.status === 'fail' ? 1 : 0);
}

const testEntries = [];
const rootSuites = Array.isArray(payload?.suites) ? payload.suites : [];
for (const suite of rootSuites) {
  collectTests(suite, testEntries);
}

const metrics = {
  generatedAt: nowIso,
  source: inputPath,
  reportFound: true,
  totalTests: testEntries.length,
  wallDurationMs:
    Number.isFinite(payload?.stats?.duration) && payload.stats.duration >= 0
      ? payload.stats.duration
      : null,
  slowestTests: [],
  files: Object.create(null),
  totalAttempts: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  timedOut: 0,
  interrupted: 0,
  flaky: 0,
  retriesUsed: 0,
  durationMs: 0,
  projects: Object.create(null),
  thresholds,
  baseline: null,
  status: 'pass',
  violations: [],
  warnings: [],
};

for (const { test, file, title, line } of testEntries) {
  const results = Array.isArray(test?.results) ? test.results : [];
  const attempts = Math.max(1, results.length);
  const statuses = results.map(result => normalizeStatus(result?.status));
  const hasFailureAttempt = statuses.some(status =>
    ['failed', 'timedOut', 'interrupted'].includes(status)
  );

  const fallbackStatus = normalizeStatus(test?.status);
  const finalStatus = statuses.length > 0 ? statuses[statuses.length - 1] : fallbackStatus;
  const retriesUsed = Math.max(0, attempts - 1);
  const isFlaky = finalStatus === 'passed' && hasFailureAttempt;

  const projectName =
    (typeof test?.projectName === 'string' && test.projectName) ||
    (typeof test?.projectId === 'string' && test.projectId) ||
    'unknown';

  if (!metrics.projects[projectName]) {
    metrics.projects[projectName] = {
      tests: 0,
      flaky: 0,
      retriesUsed: 0,
      durationMs: 0,
    };
  }

  const durationMs = results.reduce((sum, result) => sum + Number(result?.duration || 0), 0);

  metrics.slowestTests.push({ file, title, line, project: projectName, attempts, durationMs });
  metrics.files[file] ||= { tests: 0, attempts: 0, durationMs: 0 };
  metrics.files[file].tests += 1;
  metrics.files[file].attempts += attempts;
  metrics.files[file].durationMs += durationMs;

  metrics.totalAttempts += attempts;
  metrics.retriesUsed += retriesUsed;
  metrics.durationMs += durationMs;
  metrics.projects[projectName].tests += 1;
  metrics.projects[projectName].retriesUsed += retriesUsed;
  metrics.projects[projectName].durationMs += durationMs;

  if (isFlaky) {
    metrics.flaky += 1;
    metrics.projects[projectName].flaky += 1;
  }

  if (finalStatus === 'passed') metrics.passed += 1;
  else if (finalStatus === 'failed') metrics.failed += 1;
  else if (finalStatus === 'timedOut') metrics.timedOut += 1;
  else if (finalStatus === 'interrupted') metrics.interrupted += 1;
  else if (finalStatus === 'skipped') metrics.skipped += 1;
}

metrics.slowestTests.sort(
  (a, b) =>
    b.durationMs - a.durationMs ||
    a.file.localeCompare(b.file) ||
    a.title.localeCompare(b.title) ||
    a.project.localeCompare(b.project)
);
metrics.slowestTests = metrics.slowestTests.slice(0, 10);

const explicitBaseline = readJsonSafe(baselinePath);
if (explicitBaseline && explicitBaseline.reportFound) {
  metrics.baseline = {
    source: baselinePath,
    durationMs: Number(explicitBaseline.durationMs || 0),
    flaky: Number(explicitBaseline.flaky || 0),
    retriesUsed: Number(explicitBaseline.retriesUsed || 0),
  };
} else {
  metrics.baseline = computeBaselineFromHistory(historyDirPath);
}

const evaluatedMetrics = evaluateThresholds(metrics);
writeOutputs(evaluatedMetrics);

console.log(
  `[e2e-metrics] status=${evaluatedMetrics.status} tests=${evaluatedMetrics.totalTests} flaky=${evaluatedMetrics.flaky} retries=${evaluatedMetrics.retriesUsed} duration=${toSeconds(evaluatedMetrics.durationMs)}s`
);

if (enforce && evaluatedMetrics.status === 'fail') {
  console.error('[e2e-metrics] Enforcement failed due to threshold violations:');
  for (const violation of evaluatedMetrics.violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
