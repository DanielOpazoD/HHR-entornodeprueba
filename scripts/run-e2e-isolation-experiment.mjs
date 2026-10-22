#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { getIsolationLanePlan } from './e2eIsolationExperimentSupport.mjs';
import { captureTestSourceIdentity } from './testExecutionManifestSupport.mjs';
import { buildCriticalE2EEnvironment } from './config/criticalE2EEnvironment.mjs';
import { verifyEmulatorArtifact } from './setup-firestore-emulator-cache.mjs';

const root = process.cwd();
const [mode, selection, ...extra] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const resultText = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`Version probe failed: ${command}`);
  return `${result.stdout || ''} ${result.stderr || ''}`.trim().replace(/\s+/g, ' ');
};

try {
  if (!['run', 'inside', 'select'].includes(mode) || extra.length)
    throw new Error('Usage: run|inside|select full|lane-1|lane-2');
  const plan = getIsolationLanePlan(root, selection);
  const out = path.join('reports/e2e-isolation', plan.lane);
  const criticalRaw = path.join(out, 'critical.raw.json');
  const flowRaw = path.join(out, 'flow.raw.json');
  const phases = [];
  const phase = (name, command, env = process.env) => {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const result = spawnSync(command[0], command.slice(1), { env, stdio: 'inherit' });
    phases.push({
      name,
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: performance.now() - start,
      exitCode: result.status ?? 1,
      signal: result.signal ?? null,
    });
    writeJson(path.join(out, mode === 'inside' ? 'emulator-phases.json' : 'phases.json'), phases);
    if (result.error || result.signal || result.status !== 0)
      throw new Error(`${name} failed: ${result.error?.message || result.signal || result.status}`);
  };
  const capture = (name, suite, report, command, collection = false) => {
    const evidence = path.join(out, `${name}.evidence.json`);
    phase(
      name,
      [
        process.execPath,
        'scripts/report-test-execution-manifest.mjs',
        '--capture',
        'playwright',
        '--suite',
        suite,
        '--report',
        report,
        '--output',
        evidence,
        ...(collection ? ['--collection'] : []),
        '--',
        ...command,
      ],
      {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT: report,
        PLAYWRIGHT_JSON_OUTPUT_FILE: collection ? path.resolve(report) : '',
        E2E_FLOW_PLAYWRIGHT_JSON_OUTPUT: flowRaw,
      }
    );
  };

  if (mode === 'select') {
    if (selection === 'full') throw new Error('The serial control uses its existing launcher.');
    const child = spawnSync(
      process.execPath,
      [
        'node_modules/playwright/cli.js',
        'test',
        '-c',
        'playwright.emulator-critical.config.ts',
        ...plan.specs,
      ],
      { stdio: 'inherit', env: process.env }
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } else if (mode === 'inside') {
    if (selection === 'full') throw new Error('The serial control uses its existing launcher.');
    if (!process.env.FIRESTORE_EMULATOR_HOST)
      throw new Error('The experiment must run inside its own Firestore emulator.');
    phase('build', ['npm', 'run', 'build'], buildCriticalE2EEnvironment());
    capture('critical', plan.suiteId, criticalRaw, plan.command);
    if (plan.auxiliary) {
      capture('flow', 'flow', flowRaw, ['npm', 'run', 'test:e2e:flow-performance:built']);
      phase('budget', ['npm', 'run', 'check:flow-performance-budget']);
    }
  } else {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync('reports/execution/flow.evidence.json', { force: true });
    fs.mkdirSync(out, { recursive: true });
    const identity = captureTestSourceIdentity(root);
    const metadata = {
      schemaVersion: 1,
      lane: plan.lane,
      identity,
      sourceUnchanged: false,
      ci: process.env.GITHUB_RUN_ID
        ? {
            runId: process.env.GITHUB_RUN_ID,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT,
            job: process.env.GITHUB_JOB,
          }
        : null,
      startedAt: new Date().toISOString(),
      versions: {},
      phases,
    };
    try {
      if (process.env.CI && identity.worktreeDirty)
        throw new Error('Experimental CI requires a clean source checkout.');
      const { chromium } = require('playwright');
      const { getDownloadDetails } = require('firebase-tools/lib/emulator/downloadableEmulators');
      const emulator = getDownloadDetails('firestore');
      if (!(await verifyEmulatorArtifact(emulator)))
        throw new Error('The Firestore emulator must pass pinned artifact verification.');
      metadata.versions = {
        node: process.version,
        java: resultText('java', ['-version']),
        playwright: require('playwright-core/package.json').version,
        chromium: resultText(chromium.executablePath(), ['--version']),
        firestore: `${emulator.version}:${emulator.opts.expectedChecksumSHA256}`,
        lockfile: createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),
        runnerImage: `${process.env.ImageOS || os.platform()}:${process.env.ImageVersion || os.release()}`,
        runnerOS: process.env.RUNNER_OS || os.platform(),
        runnerArch: process.env.RUNNER_ARCH || os.arch(),
      };
      capture(
        'critical-list',
        'isolation-critical-list',
        path.join(out, 'critical-list.raw.json'),
        ['npm', 'run', 'test:e2e:critical', '--', '--list', '--reporter=json'],
        true
      );
      capture(
        'preview-list',
        'isolation-preview-list',
        path.join(out, 'preview-list.raw.json'),
        ['npm', 'run', 'ci:preview-smoke:built', '--', '--list', '--reporter=json'],
        true
      );
      if (plan.auxiliary) {
        phase('extension-runtime', ['npm', 'run', 'test:e2e:rayen-extension-runtime']);
        phase('extension-upgrade', ['npm', 'run', 'test:e2e:rayen-extension-upgrade']);
        phase('shared-offscreen', ['npm', 'run', 'test:e2e:shared-offscreen']);
      }
      if (selection === 'full') {
        capture('critical', plan.suiteId, criticalRaw, plan.command);
        phases.at(-1).name = 'critical-ci';
      } else {
        phase('emulator', [
          'bash',
          '-c',
          'source scripts/lib/firebase-emulator-ci.sh; ensure_java_available && run_firestore_emulator_exec "node scripts/run-e2e-isolation-experiment.mjs inside $1"',
          'e2e-isolation',
          plan.lane,
        ]);
      }
      phase('operational-metrics', [
        process.execPath,
        'scripts/report-e2e-operational-metrics.mjs',
        criticalRaw,
        '--enforce',
      ]);
      if (plan.auxiliary)
        phase('remote-performance', ['npm', 'run', 'test:e2e:census-remote-performance']);
    } catch (error) {
      metadata.error = error.message;
      process.exitCode = 1;
    } finally {
      const inner = path.join(out, 'emulator-phases.json');
      if (fs.existsSync(inner)) phases.push(...JSON.parse(fs.readFileSync(inner, 'utf8')));
      if (selection === 'full' && phases.some(p => p.name === 'critical'))
        phases.find(p => p.name === 'critical').name = 'critical-ci';
      if (selection === 'full' && fs.existsSync('reports/execution/flow.evidence.json'))
        fs.copyFileSync(
          'reports/execution/flow.evidence.json',
          path.join(out, 'flow.evidence.json')
        );
      metadata.sourceUnchanged =
        JSON.stringify(identity) === JSON.stringify(captureTestSourceIdentity(root));
      metadata.finishedAt = new Date().toISOString();
      writeJson(path.join(out, 'metadata.json'), metadata);
      if (!metadata.sourceUnchanged) process.exitCode = 1;
      if (metadata.error) console.error(`[e2e-isolation] ${metadata.error}`);
    }
  }
} catch (error) {
  console.error(`[e2e-isolation] ${error.message}`);
  process.exitCode = 1;
}
