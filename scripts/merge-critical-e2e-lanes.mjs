import { mergeCriticalLaneReports, selectLatestLaneArtifacts } from './criticalE2EMergeSupport.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { CRITICAL_LANES, criticalLaneSpecs } from './criticalE2ELanes.mjs';
import { collectPreviewSmokeCompletenessIssues } from './previewSmokeLaneSupport.mjs';
import {
  buildRequiredCiSuites,
  captureTestSourceIdentity,
  summarizeTestReporter,
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
const listings = [];
const lanes = selectLatestLaneArtifacts(
  fs.readdirSync('reports/critical-lanes'),
  CRITICAL_LANES,
  ci.runAttempt
);
for (const { lane, attempt, name } of lanes) {
  const dir = `reports/critical-lanes/${name}`;
  const readCapture = file => {
    const capture = read(`${dir}/reports/execution/${file}`);
    if (String(capture.ci?.runAttempt) !== String(attempt))
      throw new Error(`${name}/${file} was captured in another attempt`);
    return capture;
  };
  const evidence = readCapture(`critical-${lane}.evidence.json`);
  const listed = read(`${dir}/reports/e2e/critical-expected.json`);
  const files = summarizeTestReporter({
    kind: 'playwright',
    mode: 'collection',
    report: listed,
    sourceRoot: evidence.sourceRoot,
  }).files;
  const canonical = criticalLaneSpecs(lane, root);
  if (files.length !== canonical.length || canonical.some(file => !files.includes(file)))
    throw new Error(`Lane ${lane} listing differs from the canonical suite`);
  const laneIssues = collectPreviewSmokeCompletenessIssues({ listed, merged: evidence.report });
  if (laneIssues.length) throw new Error(laneIssues.join('\n'));
  listings.push(listed);
  records.push(evidence);
  if (lane === '3') {
    records.push(readCapture('flow.evidence.json'));
    records.push(readCapture('cudyr.evidence.json'));
    fs.cpSync(`${dir}/reports/e2e`, 'reports/e2e', { recursive: true });
  }
}
const expected = buildRequiredCiSuites(root).filter(suite => suite.kind === 'playwright');
const report = mergeCriticalLaneReports({ records, identity, ci, expected });
const critical = records.filter(record => record.suiteId.startsWith('critical-'));
const completeness = collectPreviewSmokeCompletenessIssues({
  listed: { suites: listings.flatMap(listed => listed.suites) },
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
