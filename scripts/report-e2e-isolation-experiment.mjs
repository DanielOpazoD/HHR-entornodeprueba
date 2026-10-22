#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureTestSourceIdentity } from './testExecutionManifestSupport.mjs';
import {
  collectIsolationExperimentIssues,
  getIsolationVariantLanes,
} from './e2eIsolationExperimentSupport.mjs';

const root = process.cwd();
const issues = [],
  references = [],
  records = [];
const args = process.argv.slice(2);
let variant = null,
  input = null,
  identity = null;
const ci = {
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  job: 'e2e-isolation-lanes',
};
try {
  if (args.length !== 4 || args[0] !== '--variant' || args[2] !== '--input' || !args[3])
    throw new Error('Usage: --variant A|B --input DIR');
  variant = args[1];
  const expected = getIsolationVariantLanes(variant);
  input = path.resolve(args[3]);
  const directories = fs.existsSync(input)
    ? fs
        .readdirSync(input, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    : [];
  for (const lane of new Set([...expected, ...directories])) {
    const record = { lane };
    for (const [key, name] of Object.entries({
      metadata: 'metadata.json',
      critical: 'critical.evidence.json',
      listed: 'critical-list.evidence.json',
      previewListed: 'preview-list.evidence.json',
      flow: 'flow.evidence.json',
    })) {
      const file = path.join(input, lane, name);
      record[key] = null;
      if (!fs.existsSync(file)) continue;
      try {
        const bytes = fs.readFileSync(file);
        references.push({
          lane,
          role: key,
          path: file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        record[key] = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        issues.push(`${file}: ${error.message}`);
      }
    }
    records.push(record);
  }
  identity = captureTestSourceIdentity(root);
  issues.push(...collectIsolationExperimentIssues({ root, variant, records, identity, ci }));
} catch (error) {
  issues.push(error.message);
}
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  variant,
  input,
  identity,
  ci,
  references,
  records: records.map(record => ({ lane: record.lane, metadata: record.metadata })),
  issues,
  limitations: [
    'This is a derived validation report. Original lane artifacts retain execution provenance.',
    'A contains a composite critical launcher phase. Phase durations are not a complete pipeline speed comparison.',
    'A successful sample does not establish a performance improvement.',
  ],
};
const output = path.join(root, 'reports/e2e-isolation');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(
  path.join(output, 'summary.md'),
  [
    '# E2E isolation experiment',
    '',
    `Variant ${variant ?? 'invalid'}. Tested SHA ${identity?.gitSha ?? 'unavailable'}.`,
    '',
    `Validation ${issues.length ? 'FAILED' : 'PASSED'}.`,
    '',
    '| Lane | Version | Value |',
    '| --- | --- | --- |',
    ...records.flatMap(record =>
      Object.entries(record.metadata?.versions || {}).map(
        ([name, value]) => `| ${record.lane} | ${name} | ${value} |`
      )
    ),
    '',
    '| Lane | Phase | Duration ms | Exit | Signal |',
    '| --- | --- | ---: | --- | --- |',
    ...records.flatMap(record =>
      (Array.isArray(record.metadata?.phases) ? record.metadata.phases : [])
        .filter(phase => phase && typeof phase === 'object')
        .map(
          phase =>
            `| ${record.lane} | ${phase.name} | ${phase.durationMs} | ${phase.exitCode} | ${phase.signal ?? ''} |`
        )
    ),
    '',
    ...references.map(
      reference =>
        `- Original ${reference.lane}/${reference.role}: \`${reference.path}\`, SHA256 \`${reference.sha256}\`.`
    ),
    '',
    ...summary.limitations.map(limit => `- ${limit}`),
    '',
    ...issues.map(issue => `- ISSUE: ${issue}`),
    '',
  ].join('\n')
);
for (const issue of issues) console.error(`[e2e-isolation] ${issue}`);
process.exitCode = issues.length ? 1 : 0;
