#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAuditAttemptEnv,
  buildAuditReproducibilityMetadata,
  classifyAuditFailure,
  getAuditFailureGuidance,
  shouldRetryAuditWithSystemCa,
} from './lib/dependencyAuditSupport.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'reports', 'security');
const outputJsonPath = path.join(reportsDir, 'dependency-audit.json');
const outputMarkdownPath = path.join(reportsDir, 'dependency-audit.md');

fs.mkdirSync(reportsDir, { recursive: true });

const workspaceConfigs = [
  {
    id: 'root',
    label: 'Root app',
    cwd: root,
    manifestPath: 'package.json',
    lockfilePath: 'package-lock.json',
  },
  {
    id: 'functions',
    label: 'Netlify/Firebase functions',
    cwd: path.join(root, 'functions'),
    manifestPath: 'functions/package.json',
    lockfilePath: 'functions/package-lock.json',
  },
];

const auditArgs = ['audit', '--audit-level=high', '--json'];

const extractCounts = report => {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (vulnerabilities && typeof vulnerabilities === 'object') {
    return {
      info: Number(vulnerabilities.info || 0),
      low: Number(vulnerabilities.low || 0),
      moderate: Number(vulnerabilities.moderate || 0),
      high: Number(vulnerabilities.high || 0),
      critical: Number(vulnerabilities.critical || 0),
      total: Number(vulnerabilities.total || 0),
    };
  }

  const advisories = report?.advisories;
  if (advisories && typeof advisories === 'object') {
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
    for (const advisory of Object.values(advisories)) {
      const severity = String(advisory?.severity || 'info');
      if (severity in counts) {
        counts[severity] += 1;
      } else {
        counts.info += 1;
      }
      counts.total += 1;
    }
    return counts;
  }

  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
};

const summarizeVulnerablePackages = report => {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return [];
  }

  return Object.entries(vulnerabilities)
    .map(([name, vulnerability]) => {
      const via = Array.isArray(vulnerability?.via)
        ? vulnerability.via.map(item => (typeof item === 'string' ? item : item?.title || 'unknown'))
        : [];
      const fixAvailable =
        vulnerability?.fixAvailable === true
          ? 'yes'
          : vulnerability?.fixAvailable && typeof vulnerability.fixAvailable === 'object'
            ? `${vulnerability.fixAvailable.name}@${vulnerability.fixAvailable.version}${vulnerability.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
            : 'no';

      return {
        name,
        severity: String(vulnerability?.severity || 'unknown'),
        isDirect: Boolean(vulnerability?.isDirect),
        fixAvailable,
        via: via.slice(0, 3),
      };
    })
    .sort((left, right) => {
      const severityRank = { critical: 5, high: 4, moderate: 3, low: 2, info: 1, unknown: 0 };
      return (
        (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0) ||
        Number(right.isDirect) - Number(left.isDirect) ||
        left.name.localeCompare(right.name)
      );
    });
};

const runAuditForWorkspace = workspace => {
  const manifestExists = fs.existsSync(path.join(root, workspace.manifestPath));
  const lockfileExists = fs.existsSync(path.join(root, workspace.lockfilePath));

  if (!manifestExists || !lockfileExists) {
    return {
      id: workspace.id,
      label: workspace.label,
      cwd: path.relative(root, workspace.cwd) || '.',
      command: `npm ${auditArgs.join(' ')}`,
      status: 'skipped',
      failureCategory: 'missing_inputs',
      exitCode: null,
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      issues: [`Missing ${!manifestExists ? workspace.manifestPath : workspace.lockfilePath}`],
    };
  }

  const runAudit = env =>
    spawnSync('npm', auditArgs, {
      cwd: workspace.cwd,
      encoding: 'utf8',
      env,
      shell: process.platform === 'win32',
    });

  let result = runAudit(process.env);
  let retriedWithSystemCa = false;

  const firstFailureCategory =
    result.status === 0
      ? null
      : classifyAuditFailure({ stderr: result.stderr || '', stdout: result.stdout || '' });

  if (
    shouldRetryAuditWithSystemCa({
      failureCategory: firstFailureCategory,
      nodeOptions: process.env.NODE_OPTIONS,
    })
  ) {
    result = runAudit(buildAuditAttemptEnv(process.env));
    retriedWithSystemCa = true;
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combinedOutput = `${stdout}\n${stderr}`.trim();

  let parsedReport = null;
  let parseError = null;

  if (stdout.trim()) {
    try {
      parsedReport = JSON.parse(stdout);
    } catch {
      parseError = 'npm audit did not return valid JSON';
      parsedReport = {
        parseError,
        rawOutput: stdout,
      };
    }
  }

  const counts = extractCounts(parsedReport);
  const vulnerablePackages = summarizeVulnerablePackages(parsedReport);
  const hasBlockingVulnerabilities = counts.high > 0 || counts.critical > 0;

  let status = 'ok';
  let failureCategory = null;
  if (parseError) {
    status = 'invalid_output';
    failureCategory = 'invalid_output';
  } else if (hasBlockingVulnerabilities) {
    status = 'vulnerable';
    failureCategory = 'high_or_critical_vulnerabilities';
  } else if (result.status !== 0) {
    status = 'unavailable';
    failureCategory = classifyAuditFailure({ stderr, stdout });
  }

  return {
    id: workspace.id,
    label: workspace.label,
    cwd: path.relative(root, workspace.cwd) || '.',
    command: `npm ${auditArgs.join(' ')}`,
    status,
    firstFailureCategory,
    failureCategory,
    guidance: failureCategory ? getAuditFailureGuidance(failureCategory) : null,
    exitCode: result.status,
    counts,
    vulnerablePackages,
    retriedWithSystemCa,
    recoveryAttempted: retriedWithSystemCa ? 'system_ca_retry' : null,
    issues:
      status === 'vulnerable'
        ? [
            `Detected ${counts.high} high and ${counts.critical} critical vulnerabilities.`,
          ]
        : combinedOutput
          ? [combinedOutput]
          : [],
    report: parsedReport,
    stderr: stderr || undefined,
  };
};

const workspaceResults = workspaceConfigs.map(runAuditForWorkspace);
const overallStatus = workspaceResults.every(result => result.status === 'ok') ? 'ok' : 'failed';
const reproducibility = buildAuditReproducibilityMetadata({
  failureCategories: workspaceResults.flatMap(result =>
    [result.firstFailureCategory, result.failureCategory].filter(Boolean)
  ),
});

const summary = {
  generatedAt: new Date().toISOString(),
  command: `npm ${auditArgs.join(' ')}`,
  overallStatus,
  policy: {
    scope: 'all dependencies',
    blockingSeverities: ['high', 'critical'],
    workspaces: workspaceConfigs.map(workspace => workspace.id),
  },
  reproducibility,
  workspaces: workspaceResults,
};

const markdown = [
  '# Dependency Audit',
  '',
  `- Overall status: \`${overallStatus}\``,
  '- Scope: `all dependencies`',
  '- Blocking severities: `high`, `critical`',
  '',
  '| Workspace | Status | High | Critical | Total | Notes |',
  '| --- | --- | ---: | ---: | ---: | --- |',
  ...workspaceResults.map(result => {
    const notes = result.failureCategory || 'ok';
    return `| ${result.label} | \`${result.status}\` | ${result.counts.high} | ${result.counts.critical} | ${result.counts.total} | ${notes} |`;
  }),
  '',
  '## Details',
  '',
  ...workspaceResults.flatMap(result => [
    `### ${result.label}`,
    '',
    `- Working directory: \`${result.cwd}\``,
    `- Status: \`${result.status}\``,
    `- First failure category: \`${result.firstFailureCategory || 'none'}\``,
    `- Failure category: \`${result.failureCategory || 'none'}\``,
    `- Retried with system CA: \`${result.retriedWithSystemCa ? 'yes' : 'no'}\``,
    `- Guidance: ${result.guidance || 'none'}`,
    `- Exit code: \`${String(result.exitCode ?? 'n/a')}\``,
    `- Counts: high=\`${result.counts.high}\`, critical=\`${result.counts.critical}\`, total=\`${result.counts.total}\``,
    ...(result.vulnerablePackages.length > 0
      ? [
          '- Top vulnerable packages:',
          ...result.vulnerablePackages
            .slice(0, 6)
            .map(
              pkg =>
                `  - ${pkg.name} [${pkg.severity}] direct=${pkg.isDirect ? 'yes' : 'no'} fix=${pkg.fixAvailable}`
            ),
        ]
      : ['- Top vulnerable packages: none']),
    ...(result.issues.length > 0 ? ['- Notes:', ...result.issues.map(issue => `  - ${issue}`)] : ['- Notes: none']),
    '',
  ]),
  '## Reproducibility',
  '',
  `- Status: \`${reproducibility.status}\``,
  `- Failure categories: \`${reproducibility.failureCategories.join(', ') || 'none'}\``,
  `- CI evidence: ${reproducibility.ciEvidence}`,
  '- Local repro commands:',
  ...reproducibility.localCommands.map(command => `  - \`${command}\``),
  '- Do not use:',
  ...reproducibility.mustNotDo.map(command => `  - \`${command}\``),
  '',
].join('\n');

fs.writeFileSync(outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
fs.writeFileSync(outputMarkdownPath, `${markdown}\n`, 'utf8');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
}

if (overallStatus !== 'ok') {
  console.error('[dependency-vulnerabilities] Dependency audit failed.');
  console.error(`[dependency-vulnerabilities] Summary written to ${path.relative(root, outputJsonPath)}`);
  process.exit(1);
}

console.log('[dependency-vulnerabilities] OK');
console.log(`[dependency-vulnerabilities] Report generated at ${path.relative(root, outputJsonPath)}`);
