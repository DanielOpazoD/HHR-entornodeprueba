import fs from 'node:fs';
import path from 'node:path';
import { buildCiRuntimeObservedProfile } from './ciRuntimeTelemetrySupport.mjs';
import { getGitReportState } from './gitReportState.mjs';
import { buildUnitShardBalanceReport } from './unitShardBalanceSupport.mjs';
import {
  patternExcludesFile,
  resolveUnitSuiteExcludePatterns,
} from './ciRiskPackMembershipSupport.mjs';

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

// The unit-risk job runs these checks before installing dependencies, so workflows are read
// without a YAML library: a job is the indented block under its key in `jobs:`, comment lines
// never count, and lists compare by value whatever their spacing or style.
const stripComments = text =>
  text
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .join('\n');

const indentOf = line => line.length - line.trimStart().length;

/** Lines of the block nested under the first `key:` line matched by `keyPattern`. */
const blockUnder = (lines, keyPattern) => {
  const start = lines.findIndex(line => keyPattern.test(line));
  if (start === -1) return null;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && indentOf(line) <= indentOf(lines[start])) break;
    block.push(line);
  }
  return block;
};

/** Workflow text without comments, or null when the file is missing. */
const readWorkflow = (root, workflowPath) =>
  fs.existsSync(path.join(root, workflowPath))
    ? stripComments(readText(root, workflowPath))
    : null;

/** Whether `text` runs `npm run <script>`, also when a folded scalar wraps the command. */
const runsScript = (text, script) =>
  new RegExp(`npm run ${escapeRegExp(script)}(?=\\s|['"]|$)`).test(
    (text ?? '').replace(/\s+/g, ' ')
  );

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text of job `jobName`, or null when the workflow has no such job. */
const jobText = (workflow, jobName) => {
  const lines = (workflow ?? '').split('\n');
  const jobs = blockUnder(lines, /^jobs:\s*$/);
  const firstKey = jobs?.find(line => line.trim());
  if (!firstKey) return null;
  const jobKey = new RegExp(
    `^ {${indentOf(firstKey)}}['"]?${escapeRegExp(jobName)}['"]?:\\s*$`
  );
  const job = blockUnder(jobs, jobKey);
  return job ? job.join('\n') : null;
};

/** Values of a `key: [a, b]` or block-list `key:` entry inside `text`. */
const listValues = (text, key) => {
  const lines = (text ?? '').split('\n');
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}:`);
  const line = lines.find(candidate => keyPattern.test(candidate));
  if (!line) return null;
  const inline = line.slice(line.indexOf(':') + 1).trim();
  const unquote = value => value.trim().replace(/^['"]|['"]$/g, '');
  if (inline.startsWith('[')) return inline.replace(/^\[|\]$/g, '').split(',').map(unquote);
  return (blockUnder(lines, keyPattern) ?? [])
    .filter(item => /^\s*-\s/.test(item))
    .map(item => unquote(item.replace(/^\s*-\s/, '')));
};

/** True when the workflow declares an artifact (or step) with this exact `name:`. */
const declaresName = (workflow, name) =>
  new RegExp(`^\\s*-?\\s*name:\\s*['"]?${escapeRegExp(name)}['"]?\\s*$`, 'm').test(workflow ?? '');

const workflowTriggers = workflow => {
  const lines = (workflow ?? '').split('\n');
  const onLine = lines.find(line => /^['"]?on['"]?:/.test(line));
  if (!onLine) return [];
  const inline = onLine.slice(onLine.indexOf(':') + 1).trim();
  if (inline) return inline.replace(/^\[|\]$/g, '').split(',').map(value => value.trim());
  const block = blockUnder(lines, /^['"]?on['"]?:\s*$/) ?? [];
  const keyIndent = Math.min(...block.filter(line => line.trim()).map(indentOf));
  return block
    .filter(line => line.trim() && indentOf(line) === keyIndent)
    .map(line => line.trim().replace(/:.*$/, '').replace(/^['"]|['"]$/g, ''));
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
    source: observed.source || null,
    generatedAt: observed.generatedAt || null,
    gitSha: observed.gitSha || null,
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
      unitShardCount: prBlockingSuites.find(suite => suite.id === 'unit-risk-shards')?.shards || 0,
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
  const ciWorkflow = readWorkflow(root, CI_WORKFLOW_PATH);
  const nightlyWorkflow = readWorkflow(root, NIGHTLY_WORKFLOW_PATH);

  if (!ciWorkflow) issues.push(`Missing ${CI_WORKFLOW_PATH}`);
  if (!nightlyWorkflow) issues.push(`Missing ${NIGHTLY_WORKFLOW_PATH}`);
  const ciCommands = ciWorkflow ?? '';
  const nightlyCommands = nightlyWorkflow ?? '';

  for (const suite of config.prBlockingSuites) {
    const job = jobText(readWorkflow(root, suite.workflow), suite.job);
    if (job === null) {
      issues.push(`${suite.id}: workflow job ${suite.job} is missing in ${suite.workflow}.`);
    }
    for (const script of scriptNamesForSuite(suite)) {
      if (!packageJson.scripts?.[script]) {
        issues.push(`${suite.id}: package.json is missing script ${script}.`);
      }
      if (job !== null && !runsScript(job, script)) {
        issues.push(`${suite.id}: job ${suite.job} does not run ${script}.`);
      }
    }
    if (
      suite.id === 'unit-risk-shards' &&
      JSON.stringify(listValues(job, 'shard')) !== JSON.stringify(['1', '2', '3', '4'])
    ) {
      issues.push('unit-risk-shards: CI matrix must keep four explicit shards.');
    }
  }

  if (!runsScript(ciCommands, 'report:test-runtime-governance')) {
    issues.push('CI must generate test runtime governance evidence in unit-risk.');
  }
  if (!declaresName(ciWorkflow, 'test-runtime-governance')) {
    issues.push('CI must upload test-runtime-governance artifact.');
  }
  if (!runsScript(ciCommands, 'check:test-runtime-governance')) {
    issues.push('CI must enforce check:test-runtime-governance.');
  }
  if (!runsScript(ciCommands, 'report:ci-runtime-observed-profile')) {
    issues.push('CI must generate observed CI runtime telemetry evidence in unit-risk.');
  }
  if (!runsScript(ciCommands, 'check:ci-runtime-telemetry')) {
    issues.push('CI must enforce check:ci-runtime-telemetry as an advisory structural contract.');
  }
  if (!declaresName(ciWorkflow, 'ci-runtime-observed-profile')) {
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

  const nightlyTriggers = workflowTriggers(nightlyWorkflow);
  if (nightlyTriggers.includes('pull_request')) {
    issues.push('nightly-test-runtime must not run on pull_request.');
  }
  if (!nightlyTriggers.includes('workflow_dispatch') || !nightlyTriggers.includes('schedule')) {
    issues.push('nightly-test-runtime must support workflow_dispatch and schedule.');
  }
  for (const suite of config.nightlySuites) {
    for (const script of scriptNamesForSuite(suite)) {
      if (!packageJson.scripts?.[script]) {
        issues.push(`${suite.id}: package.json is missing script ${script}.`);
      }
      if (!runsScript(nightlyCommands, script)) {
        issues.push(`${suite.id}: nightly workflow does not run ${script}.`);
      }
      if (runsScript(ciCommands, script)) {
        issues.push(`${suite.id}: nightly-only script ${script} is in PR CI workflow.`);
      }
    }
  }

  const unitScripts = [
    'test:ci:unit',
    ...config.prBlockingSuites
      .filter(suite => suite.id === 'unit-risk-shards')
      .flatMap(scriptNamesForSuite),
  ];
  for (const suite of config.nightlySuites) {
    for (const file of suite.testFiles || []) {
      if (!fs.existsSync(path.join(root, file))) {
        issues.push(`${suite.id}: nightly test file is missing: ${file}.`);
      }
      for (const script of new Set(unitScripts)) {
        const command = commandForScript(packageJson.scripts, script);
        if (!command) {
          issues.push(`${suite.id}: cannot verify unit membership without script ${script}.`);
          continue;
        }
        const excludes = resolveUnitSuiteExcludePatterns({ root, scriptCommand: command });
        if (!excludes.some(pattern => patternExcludesFile(pattern, file))) {
          issues.push(
            `${suite.id}: nightly-only file ${file} is included indirectly in ${script}.`
          );
        }
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
      '- CI observed unit shard runtime (stored observation; not a measurement of this report run):',
      `  - Result: ${observed.status}, ${summary.observedShardCount || 0}/${summary.expectedShardCount || 4} shard(s), ${summary.spreadPercent || 0}% observed spread.`
    );
    lines.push(
      `  - Source: ${observed.source?.provider || 'unknown'}; repository: ${observed.source?.repository || 'unknown'}; run: ${observed.source?.runId || 'unknown'}; collection: ${observed.source?.status || 'unknown'}.`,
      `  - Stored profile generated: ${observed.generatedAt || 'unknown'}; profile commit: ${observed.gitSha || 'unknown'}.`,
      '  - Use the ci-runtime-telemetry artifact for the completed workflow being evaluated; missing provenance cannot establish freshness.'
    );
    if (comparison?.advisoryFindings?.length > 0) {
      lines.push(...comparison.advisoryFindings.map(finding => `  - Advisory: ${finding}`));
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
