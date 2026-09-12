import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTRACT,
  createReport,
  nearestRank,
  validateRun,
} from '../census-startup-performance-report.mjs';
const budgets = JSON.parse(
  fs.readFileSync(new URL('../config/flow-performance-budgets.json', import.meta.url))
);
const fixture = (count = 30, mode = 'measurement') => ({
  schemaVersion: 1,
  contract: CONTRACT,
  environment: 'production',
  fixture: 'isolated-synthetic-no-real-auth-v1',
  mode,
  samplesPerScenario: count,
  runner: 'test-runner',
  browserVersion: '1.0',
  platform: 'linux-x64',
  revision: 'abc123',
  samples: ['warm_reload', 'cold_context'].flatMap(scenario =>
    Array.from({ length: count }, (_, index) => ({
      scenario,
      index,
      domVerified: true,
      visible: true,
      audit: {
        schemaVersion: 1,
        navigationId: `nav-${scenario}-${index}`,
        environment: 'production',
        timeOrigin: 100000 + index,
        navigationEvents: { 'bootstrap:start': 1, 'auth:ready': 2 },
        authAttempts: [],
        visits: [
          {
            id: `visit-${scenario}-${index}`,
            startedAt: 3,
            events: { record_available: 4, table_commit: 5, table_paint_opportunity: 6 + index },
          },
        ],
      },
    }))
  ),
});
test('nearest rank 30 samples: p50=15, p95=29, no interpolation', () => {
  const values = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(nearestRank(values, 0.5), 15);
  assert.equal(nearestRank(values, 0.95), 29);
  for (const bad of [[], Array(30), [NaN], [Infinity], [null], ['3']])
    assert.throws(() => nearestRank(bad, 0.95));
});
test('complete run passes, report omits raw identifiers and origin', () => {
  const report = createReport(fixture(), budgets);
  assert.equal(report.gate, 'passed');
  assert.equal(report.legacyComparable, false);
  assert.equal(report.scenarios.warm_reload.navigationToPaintOpportunityMs.p95, 34);
  for (const term of ['navigationId', 'timeOrigin', 'nav-warm', 'patientName'])
    assert.ok(!JSON.stringify(report).includes(term));
});
const corruptions = {
  'missing samples': r => r.samples.pop(),
  'missing scenario': r => {
    r.samples[30].scenario = 'warm_reload';
  },
  'duplicate nav': r => {
    r.samples[1].audit.navigationId = r.samples[0].audit.navigationId;
  },
  'duplicate visit': r => {
    r.samples[1].audit.visits[0].id = r.samples[0].audit.visits[0].id;
  },
  'cross-scope ID': r => {
    r.samples[0].audit.visits[0].id = r.samples[59].audit.navigationId;
  },
  'missing index': r => {
    delete r.samples[0].index;
  },
  'duplicate index': r => {
    r.samples[1].index = 0;
  },
  'missing count': r => {
    delete r.samplesPerScenario;
  },
  'missing auth attempts': r => {
    delete r.samples[0].audit.authAttempts;
  },
  'unexpected auth attempt': r => {
    r.samples[0].audit.authAttempts = [{ id: 'auth', boundary: 'google_button', events: {} }];
  },
  'wrong environment': r => {
    r.samples[0].audit.environment = 'development';
  },
  'missing visit': r => {
    r.samples[0].audit.visits = [];
  },
  'incomplete extra scope': r => {
    r.samples[0].audit.visits.push({ id: 'incomplete' });
  },
  'missing paint': r => {
    delete r.samples[0].audit.visits[0].events.table_paint_opportunity;
  },
  'NaN timing': r => {
    r.samples[0].audit.visits[0].events.record_available = NaN;
  },
  'null timing': r => {
    r.samples[0].audit.visits[0].events.record_available = null;
  },
  'negative timing': r => {
    r.samples[0].audit.visits[0].startedAt = -1;
  },
  'missing auth ready': r => {
    delete r.samples[0].audit.navigationEvents['auth:ready'];
  },
  'paint before commit': r => {
    r.samples[0].audit.visits[0].events.table_paint_opportunity = 1;
  },
  'empty prompt': r => {
    r.samples[0].domVerified = false;
  },
  'background paint': r => {
    r.samples[0].visible = false;
  },
  'PHI field': r => {
    r.samples[0].audit.visits[0].patientName = 'PRIVATE';
  },
};
for (const [label, mutate] of Object.entries(corruptions))
  test(`rejects ${label}`, () => {
    const run = fixture();
    mutate(run);
    assert.throws(() => validateRun(run));
  });
test('30 minimum, smoke explicitly excluded from baseline', () => {
  assert.throws(() => validateRun(fixture(29)));
  const smoke = fixture(2, 'smoke');
  assert.equal(createReport(smoke, budgets).baselineValid, false);
  assert.throws(() => createReport(fixture(), budgets, smoke));
});
test('unchanged repository budgets gate new timing contract', () => {
  const run = fixture();
  run.samples.forEach(sample => {
    sample.audit.visits[0].events.table_paint_opportunity = 9000;
  });
  const report = createReport(run, budgets);
  assert.equal(report.gate, 'failed');
  assert.equal(
    report.scenarios.warm_reload.navigationToPaintOpportunityMs.enforcedMaxMs,
    budgets.flows.censoVisibleMs.enforcedMaxMs
  );
  assert.throws(() => createReport(fixture(), {}));
});
test('baseline must match runtime, fixture, runner and counts', () => {
  for (const key of [
    'environment',
    'fixture',
    'contract',
    'runner',
    'browserVersion',
    'platform',
    'samplesPerScenario',
  ]) {
    const baseline = fixture();
    baseline[key] = 'different';
    assert.throws(() => createReport(fixture(), budgets, baseline));
  }
  assert.equal(createReport(fixture(), budgets, fixture()).gate, 'passed');
  const regression = fixture();
  regression.samples.forEach(sample => {
    sample.audit.visits[0].events.table_paint_opportunity += 1;
  });
  assert.equal(createReport(regression, budgets, fixture()).gate, 'failed');
});

const developmentFixture = () => {
  const run = fixture();
  run.environment = 'development';
  run.samples.forEach(sample => {
    sample.audit.environment = 'development';
  });
  return run;
};
test('development without baseline is structural-only, never production 2s budget', () => {
  const run = developmentFixture();
  run.samples.forEach(sample => {
    sample.audit.visits[0].events.table_paint_opportunity = 9000;
  });
  const report = createReport(run, {});
  assert.equal(report.gate, 'structural-only');
  assert.equal(report.budgetPolicy, 'development-no-production-budget');
  assert.equal(report.baselineCompared, false);
  assert.deepEqual(report.violations, []);
  assert.ok(!('enforcedMaxMs' in report.scenarios.warm_reload.navigationToPaintOpportunityMs));
  run.samples[0].audit.visits[0].events.table_paint_opportunity = NaN;
  assert.throws(() => createReport(run, budgets));
});
test('development baseline compares only same development runner and fixture data contract', () => {
  const run = developmentFixture();
  assert.equal(createReport(run, {}, developmentFixture()).gate, 'passed');
  const slower = developmentFixture();
  slower.samples.forEach(sample => {
    sample.audit.visits[0].events.table_paint_opportunity += 1;
  });
  assert.equal(createReport(slower, {}, run).gate, 'failed');
  assert.throws(() => createReport(run, budgets, fixture()), /Baseline mismatch: environment/);
  for (const key of ['runner', 'browserVersion', 'platform']) {
    const other = developmentFixture();
    other[key] = 'other';
    assert.throws(() => createReport(run, {}, other), /Baseline mismatch/);
  }
  const missing = developmentFixture();
  missing.samples.pop();
  assert.throws(() => createReport(run, {}, missing));
});
test('production budgets still fail, including with a matching slower baseline', () => {
  const run = fixture();
  run.samples.forEach(sample => {
    sample.audit.visits[0].events.table_paint_opportunity = 9000;
  });
  const report = createReport(run, budgets, structuredClone(run));
  assert.equal(report.gate, 'failed');
  assert.equal(report.budgetPolicy, 'production-existing-flow-budgets');
  assert.ok(report.violations.every(value => value.endsWith(':absolute-budget')));
});
test('local record remains distinct; any remote confirmation fails isolated fixture', () => {
  const run = fixture();
  run.samples.forEach(sample => {
    sample.audit.visits[0].events.local_record_available = 4;
  });
  assert.equal(createReport(run, budgets).remoteMeasured, false);
  assert.equal(run.samples[0].audit.visits[0].events.remote_confirmed, undefined);
  for (const value of [0, 4, 9000, null]) {
    const invalid = structuredClone(run);
    invalid.samples[0].audit.visits[0].events.remote_confirmed = value;
    assert.throws(() => validateRun(invalid), /Remote confirmation impossible/);
  }
});
test('verified record precedes commit while auth and local effects remain independent', () => {
  const run = fixture();
  run.samples.forEach(sample => {
    sample.audit.navigationEvents['auth:ready'] = 20;
    sample.audit.visits[0].events = {
      table_commit: 5,
      table_paint_opportunity: 6,
      record_available: 4,
      local_record_available: 9,
    };
  });
  const report = createReport(run, budgets);
  assert.equal(report.scenarios.warm_reload.recordToPaintOpportunityMs.p95, 2);
  assert.equal(report.recordToPaintSemantics, 'signed-observation-offset-not-causal-duration');
  const lateRecord = structuredClone(run);
  lateRecord.samples[0].audit.visits[0].events.record_available = 8;
  assert.throws(() => validateRun(lateRecord), /out-of-order/);
  for (const field of ['table_commit', 'record_available', 'local_record_available']) {
    const invalid = structuredClone(run);
    invalid.samples[0].audit.visits[0].events[field] = 2;
    assert.throws(() => validateRun(invalid));
  }
});
