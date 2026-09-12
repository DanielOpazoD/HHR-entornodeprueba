import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTRACT = 'census-populated-paint-v1';
export const SCENARIOS = ['warm_reload', 'cold_context'];
const fail = message => {
  throw new Error(message);
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys, label) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    fail(`Invalid ${label} keys`);
};
const finite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`Invalid ${label}`);
  return value;
};
const token = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value))
    fail(`Invalid ${label}`);
};
export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || !values.length || !(percentile > 0 && percentile <= 1))
    fail('Invalid percentile input');
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('Invalid percentile sample');
  }
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
}
export function validateRun(run) {
  exact(
    run,
    [
      'schemaVersion',
      'contract',
      'environment',
      'fixture',
      'mode',
      'samplesPerScenario',
      'runner',
      'browserVersion',
      'platform',
      'revision',
      'samples',
    ],
    'run'
  );
  if (
    run.schemaVersion !== 1 ||
    run.contract !== CONTRACT ||
    run.fixture !== 'isolated-synthetic-no-real-auth-v1'
  )
    fail('Unsupported contract/fixture');
  if (!['development', 'production'].includes(run.environment)) fail('Invalid environment');
  if (!['measurement', 'smoke'].includes(run.mode)) fail('Invalid mode');
  const count = run.samplesPerScenario;
  if (!Number.isInteger(count) || count < 1 || (run.mode === 'measurement' && count < 30))
    fail('Incomplete sample count; fewer than 30 requires smoke');
  for (const key of ['runner', 'browserVersion', 'platform', 'revision']) token(run[key], key);
  if (!Array.isArray(run.samples) || run.samples.length !== count * SCENARIOS.length)
    fail('Missing samples');
  const navIds = new Set();
  const scopeIds = new Set();
  for (const scenario of SCENARIOS) {
    const samples = run.samples.filter(sample => sample.scenario === scenario);
    if (samples.length !== count) fail('Missing scenario samples');
    const indices = new Set();
    for (const sample of samples) {
      exact(sample, ['scenario', 'index', 'domVerified', 'visible', 'audit'], 'sample');
      if (
        !Number.isInteger(sample.index) ||
        sample.index < 0 ||
        sample.index >= count ||
        indices.has(sample.index)
      )
        fail('Duplicate/missing sample index');
      indices.add(sample.index);
      if (sample.domVerified !== true || sample.visible !== true)
        fail('Populated visible DOM required');
      const audit = sample.audit;
      exact(
        audit,
        [
          'schemaVersion',
          'navigationId',
          'environment',
          'timeOrigin',
          'navigationEvents',
          'visits',
          'authAttempts',
        ],
        'audit'
      );
      if (audit.schemaVersion !== 1 || audit.environment !== run.environment)
        fail('Audit environment/schema mismatch');
      token(audit.navigationId, 'navigationId');
      if (navIds.has(audit.navigationId)) fail('Duplicate navigation ID');
      navIds.add(audit.navigationId);
      if (finite(audit.timeOrigin, 'timeOrigin') === 0) fail('Missing time origin');
      exact(audit.navigationEvents, ['auth:ready', 'bootstrap:start'], 'navigationEvents');
      finite(audit.navigationEvents['auth:ready'], 'auth:ready');
      finite(audit.navigationEvents['bootstrap:start'], 'bootstrap:start');
      // Seeded session restoration is NOT a measured Google authentication attempt.
      if (!Array.isArray(audit.authAttempts) || audit.authAttempts.length !== 0)
        fail('Unexpected/missing auth attempts for synthetic fixture');
      if (!Array.isArray(audit.visits) || audit.visits.length !== 1)
        fail('Incomplete/ambiguous visit scopes');
      const visit = audit.visits[0];
      exact(visit, ['id', 'startedAt', 'events'], 'visit');
      token(visit.id, 'visit.id');
      if (scopeIds.has(visit.id) || navIds.has(visit.id)) fail('Duplicate scope ID');
      scopeIds.add(visit.id);
      const start = finite(visit.startedAt, 'visit start');
      exact(
        visit.events,
        [
          'record_available',
          'local_record_available',
          'remote_enabled',
          'subscription_start',
          'remote_confirmed',
          'table_commit',
          'table_paint_opportunity',
        ],
        'visit events'
      );
      const record = finite(visit.events.record_available, 'record_available');
      const commit = finite(visit.events.table_commit, 'table_commit');
      const paint = finite(visit.events.table_paint_opportunity, 'table_paint_opportunity');
      // The verified table observer also records availability before commit,
      // even when React child effects precede their parent. Auth/local effects
      // remain independently observed rather than assigned artificial order.
      if (record < start || commit < record || paint < commit)
        fail('Incomplete/out-of-order timing');
      if ('remote_confirmed' in visit.events)
        fail('Remote confirmation impossible for isolated no-auth fixture');
      if (
        ['local_record_available', 'remote_enabled', 'subscription_start'].some(
          key => key in visit.events && finite(visit.events[key], key) < start
        )
      )
        fail('Out-of-scope local event');
    }
  }
  for (const id of navIds) if (scopeIds.has(id)) fail('Duplicate scope ID');
  return run;
}
const metricsFor = sample => {
  const visit = sample.audit.visits[0];
  const e = visit.events;
  return {
    navigationToPaintOpportunityMs: e.table_paint_opportunity,
    visitToRecordMs: e.record_available - visit.startedAt,
    recordToPaintOpportunityMs: e.table_paint_opportunity - e.record_available,
  };
};
export function createReport(raw, budgets, baselineRaw) {
  const run = validateRun(raw);
  const mappings = {
    navigationToPaintOpportunityMs: 'censoVisibleMs',
    visitToRecordMs: 'censoRecordReadyMs',
  };
  const applyProductionBudgets = run.environment === 'production';
  for (const key of applyProductionBudgets ? Object.values(mappings) : []) {
    if (!object(budgets?.flows?.[key]) || finite(budgets.flows[key].enforcedMaxMs, 'budget') === 0)
      fail('Missing budget');
  }
  let baseline;
  if (baselineRaw) {
    validateRun(baselineRaw);
    if (run.mode !== 'measurement' || baselineRaw.mode !== 'measurement')
      fail('Smoke is not a valid baseline');
    for (const key of [
      'contract',
      'environment',
      'fixture',
      'runner',
      'browserVersion',
      'platform',
      'samplesPerScenario',
    ]) {
      if (run[key] !== baselineRaw[key]) fail(`Baseline mismatch: ${key}`);
    }
    baseline = createReport(baselineRaw, budgets);
  }
  const scenarios = {};
  const violations = [];
  for (const scenario of SCENARIOS) {
    const samples = run.samples.filter(sample => sample.scenario === scenario).map(metricsFor);
    scenarios[scenario] = Object.fromEntries(
      Object.keys(samples[0]).map(metric => {
        const values = samples.map(sample => sample[metric]);
        const summary = {
          count: values.length,
          p50: nearestRank(values, 0.5),
          p95: nearestRank(values, 0.95),
          max: Math.max(...values),
        };
        const budgetKey = mappings[metric];
        if (budgetKey && applyProductionBudgets) {
          summary.budgetSource = budgetKey;
          summary.enforcedMaxMs = budgets.flows[budgetKey].enforcedMaxMs;
          if (summary.p95 > summary.enforcedMaxMs)
            violations.push(`${scenario}:${metric}:absolute-budget`);
        }
        if (baseline) {
          summary.baselineP95 = baseline.scenarios[scenario][metric].p95;
          summary.deltaP95Ms = summary.p95 - summary.baselineP95;
          // No invented tolerance: explicitly opt into same-runner non-regression comparison.
          // Signed record/paint observer offset is diagnostic, not causal latency.
          if (budgetKey && summary.deltaP95Ms > 0)
            violations.push(`${scenario}:${metric}:baseline-regression`);
        }
        return [metric, summary];
      })
    );
  }
  return {
    schemaVersion: 1,
    contract: CONTRACT,
    environment: run.environment,
    fixture: run.fixture,
    mode: run.mode,
    baselineValid: run.mode === 'measurement',
    runner: run.runner,
    browserVersion: run.browserVersion,
    platform: run.platform,
    revision: run.revision,
    paintSemantics: 'visible-double-rAF-opportunity-not-physical-paint',
    legacyComparable: false,
    authMeasured: false,
    remoteMeasured: false,
    recordToPaintSemantics: 'signed-observation-offset-not-causal-duration',
    budgetPolicy: applyProductionBudgets
      ? 'production-existing-flow-budgets'
      : 'development-no-production-budget',
    baselineCompared: Boolean(baseline),
    scenarios,
    violations,
    gate:
      run.mode === 'smoke'
        ? 'not-baseline-smoke'
        : violations.length
          ? 'failed'
          : !applyProductionBudgets && !baseline
            ? 'structural-only'
            : 'passed',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [input, output, baseline] = process.argv.slice(2);
    if (!input || !output)
      fail('Usage: node scripts/census-startup-performance-report.mjs RAW OUTPUT [BASELINE_RAW]');
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = createReport(
      read(input),
      read('scripts/config/flow-performance-budgets.json'),
      baseline ? read(baseline) : undefined
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`census performance: ${report.gate}`);
    if (report.gate === 'failed') process.exitCode = 1;
  } catch (error) {
    console.error(`census performance: ${error.message}`);
    process.exitCode = 1;
  }
}
