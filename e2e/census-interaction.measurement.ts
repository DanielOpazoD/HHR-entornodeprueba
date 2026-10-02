import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCanonicalE2ERecord } from './fixtures/auth';
import { loadPreviewFirebaseConfig } from './fixtures/previewFirebase';

const origin = 'http://127.0.0.1:4318';
const date = '2026-02-20';
const patient = 'SYNTHETIC CENSUS INTERACTION';
const samplesPerAction = Number(process.env.CENSUS_INTERACTION_SAMPLES ?? 5);
if (!Number.isInteger(samplesPerAction) || samplesPerAction < 3) {
  throw new Error('CENSUS_INTERACTION_SAMPLES must be an integer >= 3');
}

const record = buildCanonicalE2ERecord(date);
const beds = record.beds as Record<string, Record<string, unknown>>;
const occupiedBedIds = Object.keys(beds).filter(id => !id.startsWith('E') || id === 'E1');
const cribBedIds = ['H6C1', 'H6C2'];
if (occupiedBedIds.length !== 19) throw new Error('Full census fixture must have 19 main rows');
for (const [index, bedId] of occupiedBedIds.entries()) {
  const name = bedId === 'R1' ? patient : `SYNTHETIC PATIENT ${bedId}`;
  beds[bedId] = {
    ...beds[bedId],
    patientName: name,
    firstName: name,
    pathology: 'SYNTHETIC DIAGNOSIS',
    clinicalEpisodeId: `synthetic-episode-${bedId}`,
    specialty: 'Med Interna',
    status: 'Estable',
    age: '40',
    admissionDate: date,
    devices: index % 2 === 0 ? ['VVP#1', 'CUP'] : [],
    vitalSigns:
      index % 2 === 0
        ? {
            recordedDate: date,
            recordedAt: `${date}T10:00:00`,
            systolic: 120,
            diastolic: 80,
            heartRate: 70,
            spo2: 98,
            temperature: 36.5,
            respiratoryRate: 16,
            painEva: 0,
            hgt: null,
            insulinUnits: null,
            insulinQuadrant: null,
            observations: null,
            author: 'Synthetic',
            authorRole: 'Synthetic',
          }
        : undefined,
  };
}
for (const bedId of cribBedIds) {
  beds[bedId].clinicalCrib = {
    ...beds[bedId],
    patientName: `SYNTHETIC CRIB ${bedId}`,
    firstName: `SYNTHETIC CRIB ${bedId}`,
    clinicalEpisodeId: `synthetic-crib-episode-${bedId}`,
    identityStatus: 'provisional',
    bedMode: 'Cuna',
    specialty: 'Pediatría',
    age: '0',
    devices: [],
    vitalSigns: undefined,
  };
}
record.activeExtraBeds = ['E1'];

async function isolate(context: BrowserContext) {
  const previewConfig = loadPreviewFirebaseConfig();
  if (!previewConfig.projectId.startsWith('demo-') || !previewConfig.apiKey.startsWith('demo-')) {
    throw new Error('Census interaction benchmark requires a demo Firebase configuration');
  }
  const firebase = {
    ...previewConfig,
    projectId: 'demo-census-performance',
    authDomain: 'demo-census-performance.invalid',
  };
  await context.route('**/*', route => {
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
    if (new URL(route.url()).origin === origin.replace('http:', 'ws:')) route.connectToServer();
    else route.close();
  });
  await context.addInitScript(
    ({ fixtureDate, fixtureRecord, runtimeConfig }) => {
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
      localStorage.setItem('hhr_e2e_force_local_only_sync', 'true');
      localStorage.setItem('hhr_e2e_force_editable_record', 'true');
      localStorage.setItem('hhr_db_initialized', 'true');
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
      (window as unknown as { __HHR_E2E_OVERRIDE__: unknown }).__HHR_E2E_OVERRIDE__ = {
        [fixtureDate]: fixtureRecord,
      };
    },
    { fixtureDate: date, fixtureRecord: record, runtimeConfig: firebase }
  );
}

/** Measures click to a double-rAF opportunity after the expected UI appears. */
async function measureOpen(page: Page, trigger: string, target: string): Promise<number> {
  await page.evaluate(
    ({ triggerSelector, targetSelector }) => {
      const button = document.querySelector(triggerSelector);
      if (!button) throw new Error('Interaction trigger unavailable');
      const state = window as unknown as { __HHR_INTERACTION_SAMPLE__?: number };
      state.__HHR_INTERACTION_SAMPLE__ = undefined;
      button.addEventListener(
        'click',
        () => {
          const startedAt = performance.now();
          const observer = new MutationObserver(() => {
            const element = document.querySelector(targetSelector);
            if (!(element instanceof HTMLElement) || element.getBoundingClientRect().height === 0)
              return;
            observer.disconnect();
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                state.__HHR_INTERACTION_SAMPLE__ = performance.now() - startedAt;
              });
            });
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          window.setTimeout(() => observer.disconnect(), 10_000);
        },
        { capture: true, once: true }
      );
    },
    { triggerSelector: trigger, targetSelector: target }
  );
  await page.locator(trigger).click();
  await expect(page.locator(target)).toBeVisible();
  return page
    .waitForFunction(() =>
      Number.isFinite(
        (window as unknown as { __HHR_INTERACTION_SAMPLE__?: number }).__HHR_INTERACTION_SAMPLE__
      )
    )
    .then(handle =>
      handle.evaluate(
        () =>
          (window as unknown as { __HHR_INTERACTION_SAMPLE__: number }).__HHR_INTERACTION_SAMPLE__
      )
    );
}

const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

test('synthetic census interactions produce a privacy-safe timing baseline', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Pacific/Easter',
    locale: 'es-CL',
    serviceWorkers: 'block',
  });
  const results = { diagnosisEditor: [] as number[], clinicalPanel: [] as number[] };
  try {
    await isolate(context);
    const page = await context.newPage();
    for (let index = 0; index < samplesPerAction; index++) {
      await page.goto(`/censo?date=${date}`, { waitUntil: 'domcontentloaded' });
      const mainRows = page.locator('[data-testid="patient-row"][data-bed-id]');
      const cribRows = page.locator('[data-testid="patient-row"]:not([data-bed-id])');
      await expect(mainRows).toHaveCount(19, { timeout: 30_000 });
      await expect(cribRows).toHaveCount(2);
      for (const bedId of occupiedBedIds) {
        await expect(
          mainRows
            .and(page.locator(`[data-bed-id="${bedId}"]`))
            .locator('input[name="patientName"]')
        ).toHaveValue(String(beds[bedId].patientName));
      }
      for (const [cribIndex, bedId] of cribBedIds.entries()) {
        await expect(cribRows.nth(cribIndex).locator('input[name="patientName"]')).toHaveValue(
          `SYNTHETIC CRIB ${bedId}`
        );
      }
      results.diagnosisEditor.push(
        await measureOpen(
          page,
          '[data-testid="patient-row"][data-bed-id="R1"] button[aria-label="Editar diagnóstico"]',
          '[data-testid="clinical-block-editor-R1"]'
        )
      );
      await page.keyboard.press('Escape');
      results.clinicalPanel.push(
        await measureOpen(
          page,
          '[data-testid="clinical-panel-trigger-R1"]',
          '[data-testid="clinical-panel-drawer-R1"]'
        )
      );
    }
  } finally {
    await context.close();
  }

  const report = {
    contract: 'census-interaction-opportunity-v1',
    fixture: 'isolated-synthetic-full-census-v1',
    cohort: { mainRows: 19, clinicalCribs: 2, occupiedRows: 21, activeExtraBeds: 1 },
    semantics: 'click-to-visible-double-rAF-opportunity-not-physical-paint',
    samplesPerAction,
    actions: Object.fromEntries(
      Object.entries(results).map(([name, values]) => [
        name,
        {
          p50Ms: Math.round(percentile(values, 0.5)),
          p95Ms: Math.round(percentile(values, 0.95)),
          samplesMs: values.map(value => Math.round(value)),
        },
      ])
    ),
  };
  mkdirSync('test-results/census-interactions', { recursive: true });
  writeFileSync(
    'test-results/census-interactions/summary.json',
    JSON.stringify(report, null, 2) + '\n'
  );
  await testInfo.attach('privacy-safe-census-interactions', {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
});
