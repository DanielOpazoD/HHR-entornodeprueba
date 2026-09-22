import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const extensionPath = path.resolve('extension');
const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
const fixtureUrl = 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141121';
const gestionCamasFixtureUrl = 'https://hospitalizado.rayensalud.cl/#/bed';
const hhrFixtureUrl = 'http://localhost:3001/census';
const fixtureHtml = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Ficha clinica sintetica</title></head>
  <body><main><h2>Farmacos</h2></main></body>
</html>`;
const minimalFixtureHtml = title => `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body><main><h1>${title}</h1></main></body>
</html>`;

const requestRuntimeContext = statusPage =>
  statusPage.evaluate(
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

const readRelayHealth = statusPage =>
  statusPage.evaluate(async () => {
    const runtimeContext = await chrome.runtime.sendMessage({
      type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
    });
    const findTab = async url => (await chrome.tabs.query({ url }))[0];
    const [fichaTab, gestionCamasTab, hhrTab] = await Promise.all([
      findTab('https://fichamedico.rayensalud.cl/*'),
      findTab('https://hospitalizado.rayensalud.cl/*'),
      findTab('http://localhost:3001/*'),
    ]);
    const send = async (tab, type) => {
      if (!Number.isInteger(tab?.id)) return { error: 'missing_tab' };
      try {
        return await chrome.tabs.sendMessage(tab.id, {
          type,
          runtimeGeneration: runtimeContext.runtimeGeneration,
        });
      } catch (error) {
        return { error: String(error) };
      }
    };
    const [fichaMedico, gestionCamas, hhr] = await Promise.all([
      send(fichaTab, 'RAYEN_EXTENSION_HEALTH_PING'),
      send(gestionCamasTab, 'RAYEN_EXTENSION_HEALTH_PING'),
      send(hhrTab, 'RAYEN_EXTENSION_HHR_HEALTH_PING'),
    ]);
    return { runtimeContext, fichaMedico, gestionCamas, hhr };
  });

const requestHhrHealth = page =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const reqId = `update-e2e-${Date.now()}-${Math.random()}`;
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('HHR did not receive extension health after reload'));
        }, 15_000);
        const onMessage = event => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.type !== 'HHR_RAYEN_EXTENSION_HEALTH_RESULT' ||
            event.data?.reqId !== reqId
          )
            return;
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(event.data);
        };
        window.addEventListener('message', onMessage);
        window.postMessage(
          { type: 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST', reqId },
          window.location.origin
        );
      })
  );

const requestInvalidPatientFlow = page =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const reqId = `patient-flow-e2e-${Date.now()}-${Math.random()}`;
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('HHR patient-flow helper did not answer after reload'));
        }, 5_000);
        const onMessage = event => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.type !== 'HHR_RAYEN_PATIENT_FLOW_RESULT' ||
            event.data?.reqId !== reqId
          )
            return;
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(event.data);
        };
        window.addEventListener('message', onMessage);
        window.postMessage(
          { type: 'HHR_RAYEN_PATIENT_FLOW_REQUEST', reqId, encId: 'invalid' },
          window.location.origin
        );
      })
  );

const removeMainBridgeListener = async (context, page, source) => {
  const session = await context.newCDPSession(page);
  try {
    const evaluation = await session.send('Runtime.evaluate', {
      expression: `(() => {
        const listeners = (getEventListeners(window).message || [])
          .filter(entry => entry.listener && entry.listener.name === 'onBridgeMessage');
        listeners.forEach(entry =>
          window.removeEventListener('message', entry.listener, entry.useCapture)
        );
        return listeners.length;
      })()`,
      includeCommandLineAPI: true,
      returnByValue: true,
    });
    assert.equal(
      evaluation.result.value,
      1,
      `${source} did not expose exactly one MAIN bridge listener before recovery`
    );
  } finally {
    await session.detach();
  }
};

const runtimeErrors = [];
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
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
  const runtimeContext = await requestRuntimeContext(statusPage);
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
  await context.route('https://hospitalizado.rayensalud.cl/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: minimalFixtureHtml('Gestion de Camas sintetica'),
    })
  );
  await context.route('http://localhost:3001/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: minimalFixtureHtml('HHR sintetico'),
    })
  );

  const page = await context.newPage();
  page.on('pageerror', error =>
    runtimeErrors.push(`Rayen fixture: ${error.stack || error.message}`)
  );
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
    history.pushState({}, '', '/dashboard/encounter-list-nurse/141121?encId=999999');
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

  // Updating an unpacked MV3 extension invalidates the old ISOLATED worlds while the
  // source documents and their MAIN readers survive. The new worker must recover the
  // original generation and reconnect all three pages without navigating any of them.
  const gestionCamasPage = await context.newPage();
  const hhrPage = await context.newPage();
  for (const [fixturePage, label] of [
    [gestionCamasPage, 'Gestion de Camas fixture'],
    [hhrPage, 'HHR fixture'],
  ]) {
    fixturePage.on('pageerror', error => runtimeErrors.push(`${label}: ${error.message}`));
    fixturePage.on('console', message => {
      if (message.type() === 'error') runtimeErrors.push(`${label}: ${message.text()}`);
    });
  }
  await gestionCamasPage.goto(gestionCamasFixtureUrl);
  await hhrPage.goto(hhrFixtureUrl);
  await Promise.all([
    page.waitForFunction(() => document.documentElement.dataset.rayenRelay === '1'),
    gestionCamasPage.waitForFunction(() => document.documentElement.dataset.rayenGcRelay === '1'),
  ]);
  const documentSentinel = `document-${Date.now()}-${Math.random()}`;
  await Promise.all(
    [page, gestionCamasPage, hhrPage].map(fixturePage =>
      fixturePage.evaluate(value => {
        window.__hhrExtensionUpdateDocumentSentinel = value;
      }, documentSentinel)
    )
  );
  await removeMainBridgeListener(context, page, 'Ficha Medico');
  await removeMainBridgeListener(context, gestionCamasPage, 'Gestion de Camas');

  const extensionsPage = await context.newPage();
  await extensionsPage.goto('chrome://extensions/');
  const developerMode = extensionsPage.locator('extensions-manager extensions-toolbar #devMode');
  if ((await developerMode.getAttribute('aria-pressed')) !== 'true') {
    await developerMode.click();
  }
  await extensionsPage.locator(`extensions-item#${extensionId} #dev-reload-button`).click();

  const reloadedStatusPage = await context.newPage();
  reloadedStatusPage.on('pageerror', error =>
    runtimeErrors.push(`reloaded status page: ${error.message}`)
  );
  const statusUrl = `chrome-extension://${extensionId}/extension-status.html`;
  const statusDeadline = Date.now() + 10_000;
  while (true) {
    try {
      await reloadedStatusPage.goto(statusUrl);
      break;
    } catch (error) {
      if (Date.now() >= statusDeadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  let recoveredHealth = null;
  const recoveryDeadline = Date.now() + 15_000;
  while (Date.now() < recoveryDeadline) {
    try {
      recoveredHealth = await readRelayHealth(reloadedStatusPage);
    } catch (_error) {
      // The first message wakes the replacement worker after runtime.reload().
    }
    if (
      recoveredHealth?.hhr?.ready === true &&
      recoveredHealth?.gestionCamas?.ready === true &&
      recoveredHealth?.fichaMedico?.bridgeGeneration ===
        recoveredHealth?.runtimeContext?.runtimeGeneration
    )
      break;
    await reloadedStatusPage.waitForTimeout(200);
  }
  const reloadedWorker = context
    .serviceWorkers()
    .find(worker => worker !== serviceWorker && worker.url() === serviceWorker.url());
  assert.ok(reloadedWorker, 'Chrome did not start a replacement MV3 service worker');
  reloadedWorker.on('console', message => {
    if (message.type() === 'error')
      runtimeErrors.push(`reloaded service worker: ${message.text()}`);
  });

  assert.equal(
    recoveredHealth?.runtimeContext?.runtimeGeneration,
    runtimeContext.runtimeGeneration,
    'The reloaded worker did not recover the surviving MAIN generation'
  );
  for (const [source, health] of [
    ['HHR', recoveredHealth?.hhr],
    ['Gestion de Camas', recoveredHealth?.gestionCamas],
    ['Ficha Medico', recoveredHealth?.fichaMedico],
  ]) {
    assert.equal(
      health?.bridgeGeneration,
      runtimeContext.runtimeGeneration,
      `${source} did not reconnect to the recovered generation`
    );
    assert.notEqual(health?.reason, 'outdated_tab', `${source} remained on the stale relay`);
    assert.equal(health?.error, undefined, `${source} relay did not answer after reload`);
  }
  assert.equal(recoveredHealth.hhr.ready, true);
  assert.equal(recoveredHealth.gestionCamas.ready, true);

  const survivingDocuments = await Promise.all(
    [page, gestionCamasPage, hhrPage].map(fixturePage =>
      fixturePage.evaluate(() => window.__hhrExtensionUpdateDocumentSentinel)
    )
  );
  assert.deepEqual(
    survivingDocuments,
    [documentSentinel, documentSentinel, documentSentinel],
    'A source document navigated while the extension was recovering'
  );

  let hhrHealthResult = null;
  const aggregateHealthDeadline = Date.now() + 5_000;
  while (Date.now() < aggregateHealthDeadline) {
    hhrHealthResult = await requestHhrHealth(hhrPage);
    if (
      hhrHealthResult?.report?.hhr?.status === 'ready' &&
      hhrHealthResult?.report?.gestionCamas?.bridgeGeneration === runtimeContext.runtimeGeneration
    )
      break;
    await hhrPage.waitForTimeout(250);
  }
  assert.equal(hhrHealthResult.error, undefined);
  assert.equal(hhrHealthResult.report.runtimeGeneration, runtimeContext.runtimeGeneration);
  assert.equal(hhrHealthResult.report.hhr.status, 'ready');
  assert.equal(
    hhrHealthResult.report.gestionCamas.bridgeGeneration,
    runtimeContext.runtimeGeneration
  );
  assert.notEqual(hhrHealthResult.report.gestionCamas.reason, 'outdated_tab');
  assert.notEqual(hhrHealthResult.report.fichaMedico.reason, 'outdated_tab');
  const invalidPatientFlow = await requestInvalidPatientFlow(hhrPage);
  assert.equal(invalidPatientFlow.base64, '');
  assert.match(
    invalidPatientFlow.error,
    /episodio clínico no es válido/,
    'The reloaded HHR document did not recover its patient-flow helper'
  );
  await reloadedStatusPage.close();
  await extensionsPage.close();

  assert.deepEqual(runtimeErrors, [], `Unexpected runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log(
    `Rayen extension runtime smoke passed (MV3 v${manifest.version}, startup, update recovery, reinjection, limits, route isolation).`
  );
} finally {
  await context.close();
}
