#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inspectReportPath = reportPath => {
  const absolutePath = path.resolve(reportPath);
  let stat = null;

  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (!(error instanceof Error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (stat?.isSymbolicLink()) {
    return { absolutePath, isSymbolicLink: true, canonicalPath: null, identity: null };
  }

  if (stat && !stat.isFile()) {
    return { absolutePath, isSymbolicLink: false, canonicalPath: null, identity: null };
  }

  if (stat) {
    return {
      absolutePath,
      isSymbolicLink: false,
      canonicalPath: fs.realpathSync.native(absolutePath),
      identity: `${stat.dev}:${stat.ino}`,
    };
  }

  const canonicalParent = fs.realpathSync.native(path.dirname(absolutePath));
  return {
    absolutePath,
    isSymbolicLink: false,
    canonicalPath: path.join(canonicalParent, path.basename(absolutePath)),
    identity: null,
  };
};

export const collectPlaywrightReportPathIsolationIssues = (
  criticalReportPath,
  performanceReportPath
) => {
  const issues = [];
  let critical;
  let performance;

  try {
    critical = inspectReportPath(criticalReportPath);
  } catch (error) {
    issues.push(`Critical E2E report path could not be resolved: ${String(error)}`);
  }

  try {
    performance = inspectReportPath(performanceReportPath);
  } catch (error) {
    issues.push(`Flow performance report path could not be resolved: ${String(error)}`);
  }

  if (!critical || !performance) return issues;

  if (critical.isSymbolicLink) {
    issues.push('Critical E2E report path must not be a symbolic link.');
  }
  if (performance.isSymbolicLink) {
    issues.push('Flow performance report path must not be a symbolic link.');
  }
  if (!critical.canonicalPath) {
    issues.push('Critical E2E report path must point to a file or a new file location.');
  }
  if (!performance.canonicalPath) {
    issues.push('Flow performance report path must point to a file or a new file location.');
  }

  if (
    critical.canonicalPath &&
    performance.canonicalPath &&
    critical.canonicalPath === performance.canonicalPath
  ) {
    issues.push('Critical E2E and flow performance reports must use different paths.');
  }

  if (critical.identity && performance.identity && critical.identity === performance.identity) {
    issues.push('Critical E2E and flow performance reports must not share the same file.');
  }

  return issues;
};

const isMainModule = () =>
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule()) {
  const [criticalReportPath, performanceReportPath] = process.argv.slice(2);
  if (!criticalReportPath || !performanceReportPath) {
    console.error('Usage: check-playwright-report-path-isolation.mjs <critical> <performance>');
    process.exit(1);
  }

  const issues = collectPlaywrightReportPathIsolationIssues(
    criticalReportPath,
    performanceReportPath
  );
  if (issues.length > 0) {
    console.error('Playwright report path isolation check failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log('Playwright report paths are isolated.');
}
