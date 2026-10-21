#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  buildTestExecutionManifest,
  captureTestSourceIdentity,
  formatTestExecutionManifestMarkdown,
  summarizeTestReporter,
} from './testExecutionManifestSupport.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const delimiter = args.indexOf('--');
const options = delimiter < 0 ? args : args.slice(0, delimiter);
const option = name => {
  const index = options.indexOf(name);
  return index < 0 ? undefined : options[index + 1];
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

try {
  if (options.includes('--capture')) {
    const kind = option('--capture');
    const reportPath = option('--report');
    const output = option('--output');
    const command = delimiter < 0 ? [] : args.slice(delimiter + 1);
    if (!['vitest', 'playwright'].includes(kind) || !reportPath || !output || !command.length)
      throw new Error(
        'Usage: --capture vitest|playwright --report RAW.json --output EVIDENCE.json [--collection] -- COMMAND [ARGS]'
      );
    if (path.resolve(reportPath) === path.resolve(output))
      throw new Error('Raw report and evidence paths must differ');
    for (const file of [reportPath, output]) {
      const relative = path.relative(root, path.resolve(file));
      if (!relative.startsWith(`reports${path.sep}`))
        throw new Error('Capture paths must be under ignored reports/');
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', relative], { stdio: 'pipe' });
        throw new Error(`Capture cannot overwrite a tracked report: ${relative}`);
      } catch (error) {
        if (!error.status) throw error;
      }
    }
    const identity = captureTestSourceIdentity(root);
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(output, { force: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const startedAt = new Date().toISOString();
    const result = spawnSync(command[0], command.slice(1), {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    const after = captureTestSourceIdentity(root);
    let report = null;
    let captureError = result.error?.message;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (error) {
      captureError ||= `Reporter artifact unavailable: ${error.message}`;
    }
    const evidence = {
      schemaVersion: 1,
      ci: process.env.GITHUB_RUN_ID
        ? {
            runId: process.env.GITHUB_RUN_ID,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT,
            job: process.env.GITHUB_JOB,
          }
        : null,
      identity,
      sourceRoot: root,
      suiteId: option('--suite'),
      command,
      kind,
      mode: options.includes('--collection') ? 'collection' : 'execution',
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceUnchanged: JSON.stringify(identity) === JSON.stringify(after),
      exitCode: result.status === 0 && captureError ? 1 : (result.status ?? 1),
      signal: result.signal,
      report,
      captureError,
    };
    writeJson(output, evidence);
    process.exitCode = evidence.exitCode;
    if (captureError) throw new Error(captureError);
    summarizeTestReporter(evidence);
    if (!evidence.sourceUnchanged)
      throw new Error('Sources changed during capture; evidence cannot be used');
    process.exitCode = evidence.exitCode;
  } else {
    const inputs = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== '--input' || !options[index + 1])
        throw new Error('Usage: [--input EVIDENCE.json]...');
      const file = args[++index];
      inputs.push({
        file,
        evidence: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
      });
    }
    const manifest = buildTestExecutionManifest(root, inputs);
    writeJson('reports/test-execution-manifest.json', manifest);
    fs.writeFileSync(
      'reports/test-execution-manifest.md',
      formatTestExecutionManifestMarkdown(manifest)
    );
    console.log(
      `[test-execution-manifest] ${manifest.inventory.sourceFiles.length} source files, ${manifest.observations.length} observations. Inventory does not prove execution.`
    );
    for (const issue of manifest.issues) console.error(issue);
    if (manifest.issues.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(`[test-execution-manifest] ${error.message}`);
  process.exitCode ||= 1;
}
