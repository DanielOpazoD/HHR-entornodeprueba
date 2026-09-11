import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildCanonicalE2ERecord } from './fixtures/auth';
import {
  CONTRACT,
  createReport,
  validateRun,
} from '../scripts/census-startup-performance-report.mjs';

const origin = 'http://127.0.0.1:4318';
const date = '2026-02-20';
const patient = 'SYNTHETIC CENSUS PERFORMANCE';
const environment = process.env.CENSUS_PERF_ENV ?? 'production';
const smoke = process.env.CENSUS_PERF_SMOKE === '1';
const count = Number(process.env.CENSUS_PERF_SAMPLES ?? 30);
if (!Number.isInteger(count) || count < 1 || (!smoke && count < 30)) {
  throw new Error('At least 30 samples/scenario required; fewer only with CENSUS_PERF_SMOKE=1');
}
const firebase = {
  apiKey: 'demo-api-key',
  projectId: 'demo-census-performance',
  appId: '1:1234567890:web:synthetic',
  authDomain: 'demo-census-performance.invalid',
};
const record = buildCanonicalE2ERecord(date);
const beds = record.beds as Record<string, Record<string, unknown>>;
beds.R1 = {
  ...beds.R1,
  patientName: patient,
  firstName: patient,
  lastName: '',
  secondLastName: '',
  pathology: 'SYNTHETIC',
  status: 'Estable',
  age: '40',
  admissionDate: date,
};

async function isolate(context: BrowserContext) {
  // Routing disables Chromium HTTP cache. Both scenarios use this identical policy;
  // warm means same ephemeral context/storage + application/server/module warmup.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === '/.netlify/functions/firebase-config') {
      return route.fulfill({ json: firebase });
    }
    if (
      url.pathname.startsWith('/.netlify/') ||
      !['GET', 'HEAD'].includes(route.request().method())
    ) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, route => {
    // Vite HMR only. No Firebase or external WebSockets are permitted.
    if (new URL(route.url()).origin === origin.replace('http:', 'ws:')) route.connectToServer();
    else route.close();
  });
  await context.addInitScript(
    ({ fixtureRecord, fixtureDate, config }) => {
      localStorage.setItem('hhr_perf_audit', '1');
      if (!localStorage.getItem('census_perf_fixture_seeded')) {
        localStorage.setItem(
          'hanga_roa_hospital_data',
          JSON.stringify({ [fixtureDate]: fixtureRecord })
        );
        localStorage.setItem(
          'hhr_e2e_bootstrap_user',
          JSON.stringify({
            uid: 'synthetic-perf-user',
            email: 'synthetic@example.invalid',
            displayName: 'Synthetic',
            role: 'admin',
          })
        );
        localStorage.setItem('hhr_firebase_config', JSON.stringify(config));
        localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
        localStorage.setItem('hhr_e2e_force_editable_record', 'true');
        localStorage.setItem('hhr_db_initialized', 'true');
        localStorage.setItem('census_perf_fixture_seeded', '1');
      }
      // Explicit in-memory E2E repository fixture, NOT an emulator or real auth.
      (window as unknown as { __HHR_E2E_OVERRIDE__: unknown }).__HHR_E2E_OVERRIDE__ = JSON.parse(
        localStorage.getItem('hanga_roa_hospital_data')!
      );
    },
    { fixtureRecord: record, fixtureDate: date, config: firebase }
  );
}
async function populated(page: Page) {
  await expect(page.getByTestId('census-table')).toBeVisible();
  const input = page
    .locator('[data-testid="patient-row"][data-bed-id="R1"] input[name="patientName"]')
    .first();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(patient);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
}
async function collect(page: Page) {
  // Never accept EmptyDayPrompt as readiness. Check actual populated DOM BEFORE
  // consuming the app's paint opportunity, then recheck before taking the sample.
  await populated(page);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const audit = (
            window as unknown as {
              __HHR_CENSUS_PERF__?: { visits?: Array<{ events?: Record<string, number> }> };
            }
          ).__HHR_CENSUS_PERF__;
          return (
            audit?.visits?.some(visit => Number.isFinite(visit.events?.table_paint_opportunity)) ??
            false
          );
        }),
      { message: 'Missing real app census paint instrumentation; no synthetic fallback' }
    )
    .toBe(true);
  await populated(page);
  const audit = await page.evaluate(() => {
    const source = (
      window as unknown as {
        __HHR_CENSUS_PERF__: {
          schemaVersion: number;
          navigationId: string;
          environment: string;
          timeOrigin: number;
          navigationEvents: Record<string, number>;
          visits: Array<{ id: string; startedAt: number; events: Record<string, number> }>;
          authAttempts: Array<{ id: string; boundary: string; events: Record<string, number> }>;
        };
      }
    ).__HHR_CENSUS_PERF__;
    // Only export timing fields. No names, dates, paths, emails or clinical record.
    const select = (events: Record<string, number>, keys: string[]) =>
      Object.fromEntries(keys.filter(key => key in events).map(key => [key, events[key]]));
    return {
      schemaVersion: source.schemaVersion,
      navigationId: source.navigationId,
      environment: source.environment,
      timeOrigin: source.timeOrigin,
      navigationEvents: select(source.navigationEvents, ['auth:ready', 'bootstrap:start']),
      visits: source.visits.map(visit => ({
        id: visit.id,
        startedAt: visit.startedAt,
        events: select(visit.events, [
          'record_available',
          'local_record_available',
          'remote_confirmed',
          'table_commit',
          'table_paint_opportunity',
        ]),
      })),
      // A nonempty value fails the fixture contract rather than inventing auth latency.
      authAttempts: source.authAttempts.map(attempt => ({
        id: attempt.id,
        boundary: attempt.boundary,
        events: {},
      })),
    };
  });
  // Navigation/visit uniqueness survives hashing; original identifiers never leave the browser.
  const hash = (id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Missing scope ID');
    return createHash('sha256').update(id).digest('hex');
  };
  audit.navigationId = hash(audit.navigationId);
  audit.visits.forEach(visit => {
    visit.id = hash(visit.id);
  });
  if (audit.authAttempts.length) throw new Error('Unexpected real auth scope in synthetic fixture');
  return audit;
}

test(`census startup ${smoke ? '@smoke NOT_VALID_BASELINE' : '@measurement'} (${count}/scenario)`, async ({
  browser,
}, testInfo) => {
  const output = path.resolve(
    process.env.CENSUS_PERF_OUTPUT ??
      `reports/e2e/census-performance-${environment}${smoke ? '-smoke' : ''}.raw.json`
  );
  if (!output.endsWith('.json')) throw new Error('CENSUS_PERF_OUTPUT must end in .json');
  // Never let an interrupted/failed measurement silently reuse yesterday's report.
  if (fs.existsSync(output) || fs.existsSync(output.replace(/\.json$/, '.summary.json'))) {
    throw new Error(
      'Output already exists: choose a fresh CENSUS_PERF_OUTPUT (no automatic deletion)'
    );
  }
  const samples: Array<Record<string, unknown>> = [];
  const options = {
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Pacific/Easter',
    locale: 'es-CL',
    serviceWorkers: 'block' as const,
  };
  const warm = await browser.newContext(options);
  try {
    await isolate(warm);
    const page = await warm.newPage();
    await page.goto(`/census?date=${date}`, { waitUntil: 'domcontentloaded' });
    await collect(page); // excluded warmup, including completed double-rAF
    for (let index = 0; index < count; index++) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      samples.push({
        scenario: 'warm_reload',
        index,
        domVerified: true,
        visible: true,
        audit: await collect(page),
      });
    }
  } finally {
    await warm.close();
  }
  for (let index = 0; index < count; index++) {
    const context = await browser.newContext(options);
    try {
      await isolate(context);
      const page = await context.newPage();
      await page.goto(`/census?date=${date}`, { waitUntil: 'domcontentloaded' });
      samples.push({
        scenario: 'cold_context',
        index,
        domVerified: true,
        visible: true,
        audit: await collect(page),
      });
    } finally {
      await context.close();
    }
  }
  const run = {
    schemaVersion: 1,
    contract: CONTRACT,
    environment,
    fixture: 'isolated-synthetic-no-real-auth-v1',
    mode: smoke ? 'smoke' : 'measurement',
    samplesPerScenario: count,
    runner: process.env.CENSUS_PERF_RUNNER ?? 'local-unclassified',
    browserVersion: browser.version(),
    platform: `${process.platform}-${process.arch}`,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    samples,
  };
  validateRun(run);
  const budgets = JSON.parse(
    fs.readFileSync('scripts/config/flow-performance-budgets.json', 'utf8')
  );
  const baseline = process.env.CENSUS_PERF_BASELINE
    ? JSON.parse(fs.readFileSync(process.env.CENSUS_PERF_BASELINE, 'utf8'))
    : undefined;
  const report = createReport(run, budgets, baseline);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(run, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(
    output.replace(/\.json$/, '.summary.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' }
  );
  await testInfo.attach('privacy-safe-census-performance-summary', {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
  if (!smoke)
    expect(
      report.violations,
      'Structural/baseline gate; existing absolute budgets only for production'
    ).toEqual([]);
});
