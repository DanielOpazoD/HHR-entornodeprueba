#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { version as esbuildVersion } from 'esbuild';
import {
  buildFunctionBundle,
  buildModernFunctionEsmArtifact,
  checkMailBundleBudgets,
  loadEsmArtifact,
  readNetlifyExternalModules,
  usesModernFunctionApi,
} from './netlifyFunctionBundleSupport.mjs';
import { profileMailBundles, smokeMailBundles } from './netlifyMailRuntimeSupport.mjs';

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'netlify', 'functions');
// Keep generated JavaScript outside source scans. The private dependency link
// resolves external packages without inheriting NODE_PATH or parent credentials.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-netlify-bundle-'));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP_DIR, 'node_modules'), 'junction');
const REPORTS_DIR = path.join(ROOT, 'reports');
const policy = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/config/netlify-mail-budgets.json'), 'utf8')
);

const entryPoints = fs
  .readdirSync(FUNCTIONS_DIR)
  .filter(fileName => /\.(ts|js)$/.test(fileName))
  .map(fileName => path.join(FUNCTIONS_DIR, fileName))
  .sort();

if (entryPoints.length === 0) {
  console.error('[netlify-functions-bundle] No entrypoints found in netlify/functions');
  process.exit(1);
}

const failures = [];
const bundles = [];
const esmLoads = [];
let profiles = [];
let smoke = [];
const loadAverageBefore = os.loadavg();

try {
  for (const entryPoint of entryPoints) {
    try {
      bundles.push(await buildFunctionBundle({ root: ROOT, entryPoint, outDir: TMP_DIR }));
    } catch (error) {
      const errors = Array.isArray(error?.errors)
        ? error.errors.map(item => item.text).join('; ')
        : error instanceof Error
          ? error.message
          : 'Unknown bundling error';
      failures.push(`${path.relative(ROOT, entryPoint)} -> ${errors}`);
    }
  }
  // Modern-API functions run as unbundled ESM on Netlify: load each one the same way.
  for (const entryPoint of entryPoints) {
    if (!usesModernFunctionApi(fs.readFileSync(entryPoint, 'utf8'))) continue;
    const name = path.basename(entryPoint, path.extname(entryPoint));
    try {
      const artifact = await buildModernFunctionEsmArtifact({
        root: ROOT,
        entryPoint,
        outDir: path.join(TMP_DIR, 'esm'),
      });
      const loadError = loadEsmArtifact(artifact.path);
      esmLoads.push({ name, loaded: loadError === null });
      if (loadError) failures.push(`${name}: does not load as ESM on Netlify -> ${loadError}`);
    } catch (error) {
      failures.push(
        `${name}: ESM build failed -> ${error instanceof Error ? error.message : error}`
      );
    }
  }
  const budgetFailures = checkMailBundleBudgets(bundles, policy);
  failures.push(...budgetFailures);
  const mailBundles = bundles.filter(bundle => Object.hasOwn(policy.functions, bundle.name));
  if (budgetFailures.length === 0) {
    try {
      profiles = profileMailBundles(mailBundles);
      smoke = smokeMailBundles(mailBundles);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'Mail runtime probe failed');
    }
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim(),
    lockfileSha256: createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, 'package-lock.json')))
      .digest('hex'),
    runtime: { node: process.version, esbuild: esbuildVersion, target: 'node22', format: 'cjs' },
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      loadAverageBefore,
      loadAverageAfter: os.loadavg(),
    },
    externalModules: readNetlifyExternalModules(ROOT),
    budgets: policy.functions,
    bundles: mailBundles.map(({ path: _temporaryPath, ...bundle }) => bundle),
    profiles,
    smoke,
    esmLoads,
    failures,
    limitations: [
      'Bytes and gzip measure generated JavaScript; external packages and the deployment ZIP are excluded.',
      'Load time and RSS measure fresh local Node processes, not Netlify cold starts or email delivery latency.',
      'Load time covers requiring the artifact; Node startup and probe setup are excluded. RSS is sampled before and after loading, not peak memory.',
      'Timing is informational; size, artifact loading and safe smoke behavior are blocking.',
      'The scheduled retry export is checked without running its queue or contacting providers.',
      'Modern-API functions are also built as ESM with packages left as imports and loaded in a fresh Node process, as Netlify runs them.',
    ],
  };
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'netlify-mail-runtime.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );
  const rows = mailBundles.map(bundle => {
    const profile = profiles.find(item => item.name === bundle.name);
    const timing = profile
      ? `${profile.medianLoadMs.toFixed(2)} (${profile.minLoadMs.toFixed(2)}–${profile.maxLoadMs.toFixed(2)})`
      : 'unavailable';
    const rss = profile ? (profile.medianRssAfterBytes / 1024 ** 2).toFixed(2) : 'unavailable';
    return `| ${bundle.name} | ${bundle.bytes} | ${bundle.gzipBytes} | ${timing} | ${rss} |`;
  });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'netlify-mail-runtime.md'),
    [
      '# Netlify mail runtime',
      '',
      `Commit: ${report.sourceCommit}. Node ${process.version}; esbuild ${esbuildVersion}.`,
      '',
      '| Function | JS bytes | Gzip bytes | Median load, min–max (ms) | Median RSS after load (MiB) |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...rows,
      '',
      ...report.limitations.map(item => `- ${item}`),
      '',
      `ESM load (modern API): ${esmLoads.map(item => `${item.name} ${item.loaded ? 'ok' : 'FAILED'}`).join(', ') || 'none'}.`,
      `Smoke: ${smoke.length} artifact results. Failures: ${failures.length}.`,
      ...smoke.map(
        item =>
          `- ${item.name}: ${item.checks.length} checks passed; network attempts: ${item.networkAttempts}.`
      ),
      ...failures.map(item => `- ${item}`),
      '',
    ].join('\n')
  );
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('[netlify-functions-bundle] Bundling failures detected:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `[netlify-functions-bundle] OK (${entryPoints.length} entrypoints; ${esmLoads.length} ESM loads; ${profiles.length} mail profiles; ${smoke.length} artifact smoke results). Report: reports/netlify-mail-runtime.{json,md}`
);
