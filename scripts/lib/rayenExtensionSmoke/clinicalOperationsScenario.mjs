import assert from 'node:assert/strict';

import {
  FIXTURE_HTML,
  FIXTURE_URL,
  SYNTHETIC_SESSION,
  minimalFixtureHtml,
  requestRuntimeContext,
} from './runtimeHelpers.mjs';

export const verifyStatusPageAndRuntimeContext = async ({
  context,
  extensionId,
  manifest,
  runtimeErrors,
}) => {
  const statusPage = await context.newPage();
  statusPage.on('pageerror', error => runtimeErrors.push(`status page: ${error.message}`));
  await statusPage.goto(`chrome-extension://${extensionId}/extension-status.html`);
  assert.equal(
    await statusPage.locator('#extension-version').textContent(),
    `v${manifest.version}`,
    'The loaded extension version differs from manifest.json'
  );
  const runtimeContext = await requestRuntimeContext(statusPage);
  const installedName = await statusPage.evaluate(() => chrome.runtime.getManifest().version_name);
  assert.match(
    installedName,
    new RegExp(`^${manifest.version.replaceAll('.', '\\.')}\\+hhr1\\.[a-f0-9]{64}$`)
  );
  const installedBuildId = installedName.split('+hhr1.')[1];
  assert.equal(
    await statusPage.locator('#extension-build').textContent(),
    `Paquete ${installedBuildId.slice(0, 12)}`
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
  return runtimeContext;
};

export const installSyntheticFixtureRoutes = async ({ context, getSessionExpired }) => {
  await context.route('https://fichamedico.rayensalud.cl/**', route => {
    if (!route.request().url().includes('/api/auth/session')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: FIXTURE_HTML });
    }
    const staleTab = route.request().frame().url().includes('stale-session=1');
    return getSessionExpired() || staleTab
      ? route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false}' })
      : route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SYNTHETIC_SESSION),
        });
  });
  await context.route('https://hospitalizado.rayensalud.cl/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: minimalFixtureHtml('Gestion de Camas sintetica'),
    })
  );
  // Fail closed if a clinical request escapes the service-worker fixture.
  await context.route('https://fichamedicoback.rayensalud.cl/**', route => route.abort());
  await context.route('http://localhost:3001/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: minimalFixtureHtml('HHR sintetico'),
    })
  );
};

export const verifyInitialOperationsBarAndRouteIsolation = async ({
  context,
  manifest,
  runtimeErrors,
}) => {
  const page = await context.newPage();
  page.on('pageerror', error =>
    runtimeErrors.push(`Rayen fixture: ${error.stack || error.message}`)
  );
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`Rayen fixture: ${message.text()}`);
  });
  await page.goto(FIXTURE_URL);
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
      expectedModulesReady: ['.hhr-ops-recipes', '.hhr-ops-exams'].every(selector =>
        bar?.shadowRoot?.querySelector(selector)
      ),
      retiredModulesAbsent: ['.hhr-ops-handoff', '.hhr-ops-vitals', '.hhr-ops-scores'].every(
        selector => !bar?.shadowRoot?.querySelector(selector)
      ),
    };
  });
  assert.deepEqual(initialRuntime, {
    extensionVersion: manifest.version,
    operationBars: 1,
    prescriptionButtons: 0,
    encounterId: '141121',
    expectedModulesReady: true,
    retiredModulesAbsent: true,
  });

  await page.locator('#hhr-clinical-operations-bar .brand').click();
  const home = page.locator('#hhr-prescription-print-modal');
  assert.deepEqual(
    await home
      .locator('.hhr-center-nav-button')
      .evaluateAll(buttons => buttons.map(button => button.dataset.module)),
    ['home', 'recipes', 'lab', 'imaging', 'settings', 'connection']
  );
  assert.deepEqual(await home.locator('.hhr-home-card strong').allTextContents(), [
    'Abrir recetas',
    'Ver resultados',
    'Solicitar laboratorio',
    'Solicitar imágenes',
  ]);
  assert.doesNotMatch(await home.innerText(), /Entrega de turno|Signos vitales|Scores|BRADEN/i);
  assert.equal(await home.getByRole('link', { name: /Abrir HHR/ }).count(), 0);
  assert.equal(
    await home
      .locator('.hhr-center-content')
      .evaluate(element => element.scrollHeight <= element.clientHeight),
    true
  );
  await home.locator('.hhr-rx-close').click();

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
  assert.equal(await page.locator('#hhr-prescription-print-button').count(), 0);

  await page.evaluate(() => {
    const bar = document.querySelector('#hhr-clinical-operations-bar');
    bar?.shadowRoot?.querySelector('.hhr-ops-exams')?.click();
    bar?.shadowRoot?.querySelector('.hhr-exams-lab')?.click();
  });
  await page.locator('#hhr-prescription-print-modal .hhr-labreq-print').waitFor();

  const manualPatient = page.locator(
    '#hhr-prescription-print-modal input[name="hhr-labreq-patient-source"][value="manual"]'
  );
  const blankOrder = page.locator(
    '#hhr-prescription-print-modal input[name="hhr-labreq-patient-source"][value="blank"]'
  );
  for (let index = 0; index < 6; index += 1) {
    await manualPatient.check();
    await blankOrder.check();
  }
  await manualPatient.check();

  const longUnicodeName = 'Paciente limite Rapa Nui Ñ'.padEnd(190, 'ā');
  const nameInput = page.locator('#hhr-prescription-print-modal [data-manual="name"]');
  await nameInput.fill(longUnicodeName);
  assert.equal((await nameInput.inputValue()).length, 160, 'Manual name maxlength was bypassed');
  assert.equal(
    await page.locator('#hhr-prescription-print-modal .hhr-labreq-count').textContent(),
    '0 exámenes'
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

  return page;
};
