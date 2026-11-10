import { mergeCriticalLaneReports } from './criticalE2EMergeSupport.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CRITICAL_LANES } from './criticalE2ELanes.mjs';
import { collectPreviewSmokeCompletenessIssues } from './previewSmokeLaneSupport.mjs';
import {
  buildRequiredCiSuites,
  captureTestSourceIdentity,
} from './testExecutionManifestSupport.mjs';

const root = process.cwd();
const identity = captureTestSourceIdentity(root);
const ci = { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const records = [];
for (const lane of CRITICAL_LANES) {
  const dir = `reports/critical-lanes/e2e-critical-lane-${ci.runAttempt}-${lane}`;
  const evidence = read(`${dir}/reports/execution/critical-${lane}.evidence.json`);
  records.push(evidence);
  if (lane === '3') {
    records.push(read(`${dir}/reports/execution/flow.evidence.json`));
    records.push(read(`${dir}/reports/execution/cudyr.evidence.json`));
    fs.cpSync(`${dir}/reports/e2e`, 'reports/e2e', { recursive: true });
  }
}
const expected = buildRequiredCiSuites(root).filter(suite => suite.kind === 'playwright');
const report = mergeCriticalLaneReports({ records, identity, ci, expected });
const critical = records.filter(record => record.suiteId.startsWith('critical-'));
// Collection starts neither a browser nor a server. It proves test IDs, not just files.
const scripts = read('package.json').scripts;
const listing = spawnSync('sh', ['-c', `${scripts['test:e2e:critical']} --list --reporter=json`], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (listing.status !== 0) throw new Error(`Critical collection failed: ${listing.stderr}`);
const completeness = collectPreviewSmokeCompletenessIssues({
  listed: JSON.parse(listing.stdout),
  merged: report,
});
if (completeness.length) throw new Error(completeness.join('\n'));
write('reports/e2e/critical-playwright-report.json', report);
// This is an index of original captures, never a synthetic execution capture.
write('reports/execution/critical.evidence.json', {
  schemaVersion: 1,
  kind: 'critical-lane-index',
  lanes: critical,
});
for (const suite of ['flow', 'cudyr'])
  write(
    `reports/execution/${suite}.evidence.json`,
    records.find(record => record.suiteId === suite)
  );
