import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** @typedef {{name: string, path: string}} MailBundle */
/**
 * @typedef {{loadMs: number, rssBeforeBytes: number, rssAfterBytes: number,
 * rssDeltaBytes: number, pid: number, networkAttempts: number,
 * checks: Array<{check: string, passed: true, status?: number}>}} ProbeRun
 */
/**
 * @typedef {{name: string, runs: ProbeRun[], medianLoadMs: number, minLoadMs: number,
 * maxLoadMs: number, medianRssBeforeBytes: number, medianRssAfterBytes: number,
 * medianRssDeltaBytes: number}} MailProfile
 */

const probe = fileURLToPath(new URL('./netlify-mail-runtime-probe.cjs', import.meta.url));
const failure = (name, mode, code) => new Error(`Mail runtime ${mode} failed for ${name}: ${code}`);

/** @param {MailBundle} bundle @param {'profile'|'smoke'} mode @returns {ProbeRun} */
function runProbe(bundle, mode) {
  const artifact = path.resolve(bundle.path);
  const child = spawnSync(process.execPath, [probe, mode, artifact, bundle.name], {
    cwd: path.dirname(artifact),
    env: { NODE_ENV: 'test', URL: 'https://mail-smoke.invalid', PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (child.error)
    throw failure(bundle.name, mode, child.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn');
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    throw failure(bundle.name, mode, child.status !== 0 ? 'child_exit' : 'invalid_json');
  }
  if (child.status !== 0 || result?.ok !== true) {
    const code = [
      'network_attempt',
      'scheduled_contract',
      'handler_export',
      'smoke_status',
      'artifact_failure',
      'uncaught_exception',
      'unhandled_rejection',
      'unknown_entrypoint',
    ].includes(result?.code)
      ? result.code
      : 'child_exit';
    throw failure(bundle.name, mode, code);
  }
  if (
    !['loadMs', 'rssBeforeBytes', 'rssAfterBytes', 'rssDeltaBytes', 'pid', 'networkAttempts'].every(
      key => typeof result[key] === 'number' && Number.isFinite(result[key])
    ) ||
    result.loadMs <= 0 ||
    result.rssBeforeBytes <= 0 ||
    result.rssAfterBytes <= 0 ||
    result.pid <= 0 ||
    result.networkAttempts !== 0 ||
    !Array.isArray(result.checks) ||
    !result.checks.every(
      check =>
        check &&
        typeof check === 'object' &&
        typeof check.check === 'string' &&
        check.passed === true &&
        (check.status === undefined ||
          (Number.isInteger(check.status) && check.status >= 100 && check.status <= 599))
    ) ||
    (mode === 'smoke' && !result.checks.length)
  ) {
    throw failure(bundle.name, mode, 'invalid_result');
  }
  const { ok, ...run } = result;
  return run;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * @param {MailBundle[]} bundles
 * @param {{repetitions?: number}} [options]
 * @returns {MailProfile[]}
 */
export function profileMailBundles(bundles, { repetitions = 5 } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1)
    throw new Error('Invalid profile repetitions');
  const rows = bundles.map(bundle => ({ name: bundle.name, runs: [] }));
  // Each pass measures every artifact in a new process, avoiding grouped fixed-order drift.
  for (let pass = 0; pass < repetitions; pass += 1) {
    for (let index = 0; index < bundles.length; index += 1) {
      rows[index].runs.push(runProbe(bundles[index], 'profile'));
    }
  }
  return rows.map(row => ({
    ...row,
    medianLoadMs: median(row.runs.map(run => run.loadMs)),
    minLoadMs: Math.min(...row.runs.map(run => run.loadMs)),
    maxLoadMs: Math.max(...row.runs.map(run => run.loadMs)),
    medianRssBeforeBytes: median(row.runs.map(run => run.rssBeforeBytes)),
    medianRssAfterBytes: median(row.runs.map(run => run.rssAfterBytes)),
    medianRssDeltaBytes: median(row.runs.map(run => run.rssDeltaBytes)),
  }));
}

/** @param {MailBundle[]} bundles @returns {Array<ProbeRun & {name: string}>} */
export function smokeMailBundles(bundles) {
  return bundles.map(bundle => ({ name: bundle.name, ...runProbe(bundle, 'smoke') }));
}
