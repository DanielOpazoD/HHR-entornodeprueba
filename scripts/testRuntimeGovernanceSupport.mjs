import fs from 'node:fs';
import path from 'node:path';
import { parseWorkflowJobs } from './ciArtifactContractSupport.mjs';
import { buildCiRuntimeObservedProfile } from './ciRuntimeTelemetrySupport.mjs';
import { getGitReportState } from './gitReportState.mjs';
import { buildUnitShardBalanceReport } from './unitShardBalanceSupport.mjs';

const CONFIG_PATH = 'scripts/config/test-runtime-governance.json';
const PACKAGE_JSON_PATH = 'package.json';
const CI_WORKFLOW_PATH = '.github/workflows/ci-cd.yml';
const NIGHTLY_WORKFLOW_PATH = '.github/workflows/nightly-test-runtime.yml';

const readText = (root, relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const readJson = (root, relativePath) => JSON.parse(readText(root, relativePath));

const safeReadJson = (root, relativePath) => {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const scriptNamesForSuite = suite => [
  ...(suite.script ? [suite.script] : []),
  ...(Array.isArray(suite.scripts) ? suite.scripts : []),
];

const workflowBodyForJob = (root, workflowPath, jobName) => {
  const filePath = path.join(root, workflowPath);
  if (!fs.existsSync(filePath)) return '';
  return parseWorkflowJobs(readText(root, workflowPath)).get(jobName)?.body || '';
};

const commandForScript = (packageScripts, scriptName) => packageScripts?.[scriptName] || '';

const readQualityProfileSlowSignals = root => {
  const profile = safeReadJson(root, 'reports/ci-quality-static-profile.json');
  const results = Array.isArray(profile?.results) ? profile.results : [];
  return results
    .filter(result => typeof result?.durationMs === 'number')
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 8)
    .map(result => ({
      id: String(result.id || 'unknown'),
      group: String(result.group || 'unknown'),
      durationMs: Math.round(result.durationMs),
    }));
};

const readE2eOperationalSignal = root => {
  const metrics = safeReadJson(root, 'reports/e2e/critical-operational-metrics.json');
  if (!metrics) return null;
  return {
    id: 'e2e-critical',
    durationMs: Math.round(Number(metrics.durationMs || 0)),
    totalTests: Number(metrics.totalTests || 0),
    flaky: Number(metrics.flaky || 0),
  };
};

const readUnitShardBalanceSignal = root => {
  try {
    const report = buildUnitShardBalanceReport(root);
    return {
      totalFiles: report.summary.totalFiles,
      shardCount: report.summary.shardCount,
      spreadPercent: report.summary.spreadPercent,
      tolerancePercent: report.summary.tolerancePercent,
      perFileOverheadMs: report.summary.perFileOverheadMs,
      shards: report.shards.map(shard => ({
        index: shard.index,
        files: shard.files.length,
        estimatedDurationMs: shard.estimatedDurationMs,
      })),
    };
  } catch {
    return null;
  }
};

const readCiRuntimeObservedSignal = root => {
  const observed = safeReadJson(root, 'reports/ci-runtime-observed-profile.json');
  if (!observed) {
    return buildCiRuntimeObservedProfile({ jobs: [], tolerancePercent: 25 });
  }
  return {
    status: observed.status,
    summary: observed.summary,
    recommendation: observed.recommendation,
    comparison: observed.comparison || null,
  };
};

const walkTestFiles = root => {
  const testRoot = path.join(root, 'src/tests');
  const files = [];

  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  };

  walk(testRoot);
  return files;
};

const countFixtureSignalFiles = (root, predicate) =>
  walkTestFiles(root).filter(file => {
    const content = readText(root, file);
    return predicate(content, file);
  });

const collectFixtureDuplicationSignals = root => {
  const inlineDailyRecordFiles = countFixtureSignalFiles(
    root,
    content =>
      content.includes("from '@/types/domain/dailyRecord'") &&
      (content.includes('beds: {') || content.includes('beds: [')) &&
      !content.includes('DataFactory.createMockDailyRecord')
  );
  const runtimeMockFiles = countFixtureSignalFiles(
    root,
    content =>
      content.includes("vi.mock('@/shared/runtime/browserWindowRuntimeCore'") ||
      content.includes('vi.mock("@/shared/runtime/browserWindowRuntimeCore"')
  );
  const customSyncScenarioFiles = countFixtureSignalFiles(
    root,
    (content, file) =>
      content.includes('expectedVersion') &&
      content.includes('changedPaths') &&
      !file.startsWith('src/tests/support/clinicalSyncSimulator/')
  );

  return [
    {
      id: 'large-inline-daily-record',
      files: inlineDailyRecordFiles.length,
      examples: inlineDailyRecordFiles.slice(0, 5),
      preferred: 'shared DailyRecord builders under src/tests/support or src/tests/utils',
    },
    {
      id: 'browser-runtime-mock',
      files: runtimeMockFiles.length,
      examples: runtimeMockFiles.slice(0, 5),
      preferred: 'src/tests/utils/browserWindowRuntimeMock.ts',
    },
    {
      id: 'sync-client-scenario',
      files: customSyncScenarioFiles.length,
      examples: customSyncScenarioFiles.slice(0, 5),
      preferred: 'src/tests/support/clinicalSyncSimulator',
    },
  ];
};

export const loadTestRuntimeGovernanceConfig = root => readJson(root, CONFIG_PATH);

export const buildTestRuntimeGovernanceReport = root => {
  const config = loadTestRuntimeGovernanceConfig(root);
  const packageJson = readJson(root, PACKAGE_JSON_PATH);
  const gitState = getGitReportState(root);
  const e2eSignal = readE2eOperationalSignal(root);
  const prBlockingSuites = config.prBlockingSuites.map(suite => ({
    ...suite,
    scripts: scriptNamesForSuite(suite),
    commands: scriptNamesForSuite(suite).map(script => ({
      script,
      command: commandForScript(packageJson.scripts, script),
    })),
  }));
  const nightlySuites = config.nightlySuites.map(suite => ({
    ...suite,
    scripts: scriptNamesForSuite(suite),
    commands: scriptNamesForSuite(suite).map(script => ({
      script,
      command: commandForScript(packageJson.scripts, script),
    })),
  }));

  return {
    reportId: 'test-runtime-governance',
    generatedAt: new Date().toISOString(),
    ...gitState,
    budgets: config.budgets,
    summary: {
      prBlockingSuites: prBlockingSuites.length,
      nightlySuites: nightlySuites.length,
      unitShardCount:
        prBlockingSuites.find(suite => suite.id === 'unit-risk-shards')?.shards || 0,
      fixtureWatchlistItems: config.fixtureGovernance.duplicationWatchlist.length,
    },
    prBlockingSuites,
    nightlySuites,
    slowRuntimeSignals: {
      qualityStaticSlowest: readQualityProfileSlowSignals(root),
      e2eCritical: e2eSignal,
      unitShardBalance: readUnitShardBalanceSignal(root),
      ciRuntimeObserved: readCiRuntimeObservedSignal(root),
    },
    fixtureGovernance: {
      ...config.fixtureGovernance,
      signals: collectFixtureDuplicationSignals(root),
    },
  };
};

export const collectTestRuntimeGovernanceIssues = root => {
  const issues = [];
  const config = loadTestRuntimeGovernanceConfig(root);
  const packageJson = readJson(root, PACKAGE_JSON_PATH);
  const ciWorkflow = fs.existsSync(path.join(root, CI_WORKFLOW_PATH))
    ? readText(root, CI_WORKFLOW_PATH)
    : '';
  const nightlyWorkflow = fs.existsSync(path.join(root, NIGHTLY_WORKFLOW_PATH))
    ? readText(root, NIGHTLY_WORKFLOW_PATH)
    : '';

  if (!ciWorkflow) issues.push(`Missing ${CI_WORKFLOW_PATH}`);
  if (!nightlyWorkflow) issues.push(`Missing ${NIGHTLY_WORKFLOW_PATH}`);

  for (const suite of config.prBlockingSuites) {
    const jobBody = workflowBodyForJob(root, suite.workflow, suite.job);
    if (!jobBody) {
      issues.push(`${suite.id}: workflow job ${suite.job} is missing in ${suite.workflow}.`);
    }
    for (const script of scriptNamesForSuite(suite)) {
      if (!packageJson.scripts?.[script]) {
        issues.push(`${suite.id}: package.json is missing script ${script}.`);
      }
      if (jobBody && !jobBody.includes(`npm run ${script}`)) {
        issues.push(`${suite.id}: job ${suite.job} does not run ${script}.`);
      }
    }
    if (suite.id === 'unit-risk-shards' && !jobBody.includes(`shard: [1, 2, 3, 4]`)) {
      issues.push('unit-risk-shards: CI matrix must keep four explicit shards.');
    }
  }

  if (!ciWorkflow.includes('npm run report:test-runtime-governance')) {
    issues.push('CI must generate test runtime governance evidence in unit-risk.');
  }
  if (!ciWorkflow.includes('name: test-runtime-governance')) {
    issues.push('CI must upload test-runtime-governance artifact.');
  }
  if (!ciWorkflow.includes('npm run check:test-runtime-governance')) {
    issues.push('CI must enforce check:test-runtime-governance.');
  }
  if (!ciWorkflow.includes('npm run report:ci-runtime-observed-profile')) {
    issues.push('CI must generate observed CI runtime telemetry evidence in unit-risk.');
  }
  if (!ciWorkflow.includes('npm run check:ci-runtime-telemetry')) {
    issues.push('CI must enforce check:ci-runtime-telemetry as an advisory structural contract.');
  }
  if (!ciWorkflow.includes('name: ci-runtime-observed-profile')) {
    issues.push('CI must upload ci-runtime-observed-profile artifact.');
  }
  if (!packageJson.scripts?.['check:unit-shard-balance']) {
    issues.push('package.json is missing script check:unit-shard-balance.');
  }
  if (!packageJson.scripts?.['report:unit-shard-runtime-profile']) {
    issues.push('package.json is missing script report:unit-shard-runtime-profile.');
  }
  if (!packageJson.scripts?.['check:ci-runtime-telemetry']) {
    issues.push('package.json is missing script check:ci-runtime-telemetry.');
  }
  if (!packageJson.scripts?.['report:ci-runtime-observed-profile']) {
    issues.push('package.json is missing script report:ci-runtime-observed-profile.');
  }

  if (nightlyWorkflow.includes('pull_request:')) {
    issues.push('nightly-test-runtime must not run on pull_request.');
  }
  if (!nightlyWorkflow.includes('workflow_dispatch:') || !nightlyWorkflow.includes('schedule:')) {
    issues.push('nightly-test-runtime must support workflow_dispatch and schedule.');
  }
  for (const suite of config.nightlySuites) {
    for (const script of scriptNamesForSuite(suite)) {
      if (!packageJson.scripts?.[script]) {
        issues.push(`${suite.id}: package.json is missing script ${script}.`);
      }
      if (!nightlyWorkflow.includes(`npm run ${script}`)) {
        issues.push(`${suite.id}: nightly workflow does not run ${script}.`);
      }
      if (ciWorkflow.includes(`npm run ${script}`)) {
        issues.push(`${suite.id}: nightly-only script ${script} is in PR CI workflow.`);
      }
    }
  }

  const fixtureGovernance = config.fixtureGovernance;
  if (!Array.isArray(fixtureGovernance?.duplicationWatchlist)) {
    issues.push('fixtureGovernance.duplicationWatchlist must be configured.');
  } else if (fixtureGovernance.duplicationWatchlist.length < 3) {
    issues.push('fixtureGovernance.duplicationWatchlist must track at least three fixture risks.');
  }
  for (const fixtureRoot of fixtureGovernance.preferredSharedFixtureRoots || []) {
    if (!fs.existsSync(path.join(root, fixtureRoot))) {
      issues.push(`fixtureGovernance preferred root is missing: ${fixtureRoot}`);
    }
  }

  return issues;
};

const formatMinutes = minutes => `${Number(minutes).toFixed(1).replace(/\\.0$/, '')}m`;
const formatMs = ms => `${(Number(ms || 0) / 1000).toFixed(1)}s`;

export const formatTestRuntimeGovernanceMarkdown = report => {
  const lines = [
    '# Test Runtime Governance',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Git SHA: \`${report.gitSha}\``,
    `- Worktree dirty: \`${report.gitDirty}\``,
    `- PR critical path budget: ${formatMinutes(report.budgets.prCriticalPathMinutes)}`,
    '',
    '## PR Blocking Suites',
    '',
    '| Suite | Scripts | Budget | Reason |',
    '| --- | --- | ---: | --- |',
    ...report.prBlockingSuites.map(
      suite =>
        `| ${suite.label} | ${suite.scripts.map(script => `\`${script}\``).join('<br>')} | ${formatMinutes(suite.maxMinutes)} | ${suite.reason} |`
    ),
    '',
    '## Nightly Suites',
    '',
    '| Suite | Script | Budget | Reason |',
    '| --- | --- | ---: | --- |',
    ...report.nightlySuites.map(
      suite =>
        `| ${suite.label} | ${suite.scripts.map(script => `\`${script}\``).join('<br>')} | ${formatMinutes(suite.maxMinutes)} | ${suite.reason} |`
    ),
    '',
    '## Slow Runtime Signals',
    '',
  ];

  if (report.slowRuntimeSignals.qualityStaticSlowest.length === 0) {
    lines.push('- No local quality-static profile available.');
  } else {
    lines.push('| Check | Group | Duration |', '| --- | --- | ---: |');
    for (const signal of report.slowRuntimeSignals.qualityStaticSlowest) {
      lines.push(`| \`${signal.id}\` | ${signal.group} | ${formatMs(signal.durationMs)} |`);
    }
  }

  if (report.slowRuntimeSignals.e2eCritical) {
    const e2e = report.slowRuntimeSignals.e2eCritical;
    lines.push(
      '',
      `- E2E critical: ${e2e.totalTests} tests, ${e2e.flaky} flaky, ${formatMs(e2e.durationMs)}.`
    );
  }

  if (report.slowRuntimeSignals.unitShardBalance) {
    const balance = report.slowRuntimeSignals.unitShardBalance;
    lines.push(
      '',
      `- Unit shard balance: ${balance.totalFiles} files, ${balance.spreadPercent}% spread across ${balance.shardCount} shard(s), tolerance ${balance.tolerancePercent}%, per-file overhead ${(Number(balance.perFileOverheadMs || 0) / 1000).toFixed(1)}s.`
    );
  }

  if (report.slowRuntimeSignals.ciRuntimeObserved) {
    const observed = report.slowRuntimeSignals.ciRuntimeObserved;
    const summary = observed.summary || {};
    const comparison = observed.comparison;
    lines.push(
      '',
      `- CI observed unit shard runtime: ${observed.status}, ${summary.observedShardCount || 0}/${summary.expectedShardCount || 4} shard(s), ${summary.spreadPercent || 0}% observed spread.`
    );
    if (comparison?.advisoryFindings?.length > 0) {
      lines.push(
        ...comparison.advisoryFindings.map(finding => `  - Advisory: ${finding}`)
      );
    } else if (observed.recommendation) {
      lines.push(`  - Advisory: ${observed.recommendation}`);
    }
  }

  lines.push(
    '',
    '## Fixture Duplication Governance',
    '',
    `- Max inline DailyRecord fixture lines: ${report.fixtureGovernance.maxInlineDailyRecordFixtureLines}`,
    `- Preferred roots: ${report.fixtureGovernance.preferredSharedFixtureRoots.map(item => `\`${item}\``).join(', ')}`,
    '',
    '| Watchlist | Preferred Home | Reason |',
    '| --- | --- | --- |',
    ...report.fixtureGovernance.duplicationWatchlist.map(
      item => `| ${item.pattern} | ${item.preferred} | ${item.reason} |`
    ),
    '',
    '## Fixture Duplication Signals',
    '',
    '| Signal | Files | Examples | Preferred Home |',
    '| --- | ---: | --- | --- |',
    ...report.fixtureGovernance.signals.map(
      signal =>
        `| ${signal.id} | ${signal.files} | ${signal.examples.map(item => `\`${item}\``).join('<br>') || 'none'} | ${signal.preferred} |`
    ),
    ''
  );

  return `${lines.join('\n')}\n`;
};
