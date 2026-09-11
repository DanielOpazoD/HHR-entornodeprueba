import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const extensionPath = path.resolve('extension');
const manifest = JSON.parse(
  await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')
);
const fixtureUrl =
  'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141121';
const fixtureHtml = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Ficha clinica sintetica</title></head>
  <body><main><h2>Farmacos</h2></main></body>
</html>`;

const runtimeErrors = [];
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  const serviceWorker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extensionId = new URL(serviceWorker.url()).host;

  serviceWorker.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`service worker: ${message.text()}`);
  });

  assert.equal(
    new URL(serviceWorker.url()).pathname,
    `/${manifest.background.service_worker}`,
    'Chrome did not start the declared MV3 service worker'
  );

  const statusPage = await context.newPage();
  statusPage.on('pageerror', error => runtimeErrors.push(`status page: ${error.message}`));
  await statusPage.goto(`chrome-extension://${extensionId}/extension-status.html`);
  assert.equal(
    await statusPage.locator('#extension-version').textContent(),
    `v${manifest.version}`,
    'The loaded extension version differs from manifest.json'
  );
  const runtimeContext = await statusPage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST' },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      })
  );
  assert.equal(
    runtimeContext?.version,
    manifest.version,
    'The MV3 message router did not report the loaded version'
  );
  assert.match(
    runtimeContext?.runtimeGeneration || '',
    /^[a-f0-9-]{20,}$/i,
    'The MV3 background runtime did not initialize its generation'
  );
  assert.equal(
    Number.isFinite(runtimeContext?.runtimeStartedAt),
    true,
    'The MV3 background runtime did not report its start time'
  );
  await statusPage.close();

  await context.route('https://fichamedico.rayensalud.cl/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml })
  );

  const page = await context.newPage();
  page.on('pageerror', error => runtimeErrors.push(`Rayen fixture: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`Rayen fixture: ${message.text()}`);
  });
  await page.goto(fixtureUrl);
  await page.waitForFunction(
    () => document.documentElement.dataset.hhrPrescriptionPrintState === 'ready'
  );

  const initialRuntime = await page.evaluate(() => {
    const bar = document.querySelector('#hhr-clinical-operations-bar');
    return {
      extensionVersion: document.documentElement.dataset.hhrPrescriptionPrintScript,
      operationBars: document.querySelectorAll('#hhr-clinical-operations-bar').length,
      prescriptionButtons: document.querySelectorAll('#hhr-prescription-print-button').length,
      encounterId: bar?.dataset.encounterId,
      expectedModulesReady: [
        '.hhr-ops-recipes',
        '.hhr-ops-handoff',
        '.hhr-ops-vitals',
        '.hhr-ops-scores',
        '.hhr-ops-exams',
      ].every(selector => bar?.shadowRoot?.querySelector(selector)),
    };
  });
  assert.deepEqual(initialRuntime, {
    extensionVersion: manifest.version,
    operationBars: 1,
    prescriptionButtons: 1,
    encounterId: '141121',
    expectedModulesReady: true,
  });

  // Mutation-heavy React screens must not duplicate controls or destabilize reinjection.
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 500; index += 1) {
      const node = document.createElement('span');
      node.textContent = `actualizacion-${index}`;
      fragment.appendChild(node);
    }
    document.querySelector('main')?.appendChild(fragment);
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#hhr-clinical-operations-bar').count(), 1);
  assert.equal(await page.locator('#hhr-prescription-print-button').count(), 1);

  await page.evaluate(() => {
    const bar = document.querySelector('#hhr-clinical-operations-bar');
    bar?.shadowRoot?.querySelector('.hhr-ops-exams')?.click();
    bar?.shadowRoot?.querySelector('.hhr-exams-lab')?.click();
  });
  await page.locator('#hhr-prescription-print-modal .hhr-labreq-print').waitFor();

  const manualPatient = page.locator(
    '#hhr-prescription-print-modal input[name="hhr-labreq-patient-source"][value="manual"]'
  );
  const currentPatient = page.locator(
    '#hhr-prescription-print-modal input[name="hhr-labreq-patient-source"][value="current"]'
  );
  for (let index = 0; index < 6; index += 1) {
    await manualPatient.check();
    await currentPatient.check();
  }
  await manualPatient.check();

  const longUnicodeName = 'Paciente limite Rapa Nui Ñ'.padEnd(190, 'ā');
  const nameInput = page.locator('#hhr-prescription-print-modal [data-manual="name"]');
  await nameInput.fill(longUnicodeName);
  assert.equal((await nameInput.inputValue()).length, 160, 'Manual name maxlength was bypassed');
  assert.equal(
    await page.locator('#hhr-prescription-print-modal .hhr-labreq-count').textContent(),
    '0 exámenes seleccionados'
  );
  assert.equal(
    await page.locator('#hhr-prescription-print-modal .hhr-labreq-print').isEnabled(),
    true,
    'A blank laboratory order should be printable for a named manual patient'
  );

  // A conflicting route/query pair must clear all patient-specific actions.
  await page.evaluate(() => {
    history.pushState(
      {},
      '',
      '/dashboard/encounter-list-nurse/141121?encId=999999'
    );
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.hhrPrescriptionPrintState === 'operations-ready'
  );
  assert.equal(await page.locator('#hhr-prescription-print-button').count(), 0);
  assert.equal(await page.locator('#hhr-prescription-print-modal').count(), 0);
  assert.equal(
    await page.locator('#hhr-clinical-operations-bar').getAttribute('data-encounter-id'),
    ''
  );

  assert.deepEqual(runtimeErrors, [], `Unexpected runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log(
    `Rayen extension runtime smoke passed (MV3 v${manifest.version}, startup, reinjection, limits, route isolation).`
  );
} finally {
  await context.close();
}
