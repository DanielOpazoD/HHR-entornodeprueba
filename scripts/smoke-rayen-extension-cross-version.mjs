import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

// #473 is the last released 0.48.32 tree. Pin the commit so the fixture cannot
// silently change when a branch or tag moves.
const PREVIOUS_REF = 'a6704bcbe412db12975948e76199778875a9529e';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSION = path.join(ROOT, 'extension');
const currentManifest = JSON.parse(
  await readFile(path.join(SOURCE_EXTENSION, 'manifest.json'), 'utf8')
);
const fixtureUrl = 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141121';
const fixtureHtml = title =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1></main></body></html>`;
const syntheticSession = JSON.stringify({
  ok: true,
  session: {
    token: 'fixture',
    facilityId: '1',
    healthCarePractitionerId: '2',
    healthCarePractitionerRoleId: '3',
    role: 'Enfermera',
    fullName: 'Profesional de prueba',
  },
});

const runtimeContext = page =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST' }, value => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(value);
        });
      })
  );

const relayHealth = page =>
  page.evaluate(async () => {
    const runtime = await chrome.runtime.sendMessage({
      type: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
    });
    const sources = [
      ['ficha', 'https://fichamedico.rayensalud.cl/*', 'RAYEN_EXTENSION_HEALTH_PING'],
      ['camas', 'https://hospitalizado.rayensalud.cl/*', 'RAYEN_EXTENSION_HEALTH_PING'],
      ['hhr', 'http://localhost:3001/*', 'RAYEN_EXTENSION_HHR_HEALTH_PING'],
    ];
    const values = await Promise.all(
      sources.map(async ([name, url, type]) => {
        const [tab] = await chrome.tabs.query({ url });
        if (!tab?.id) return [name, { error: 'missing_tab' }];
        try {
          return [
            name,
            await chrome.tabs.sendMessage(tab.id, {
              type,
              runtimeGeneration: runtime.runtimeGeneration,
            }),
          ];
        } catch (error) {
          return [name, { error: String(error) }];
        }
      })
    );
    return { runtime, ...Object.fromEntries(values) };
  });

const clinicalBundle = (page, fecha) =>
  page.evaluate(
    clinicalDay =>
      new Promise((resolve, reject) => {
        const reqId = `upgrade-clinical-${Date.now()}-${Math.random()}`;
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('HHR did not receive the clinical bundle after version upgrade'));
        }, 12_000);
        const onMessage = event => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.type !== 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_RESULT' ||
            event.data?.reqId !== reqId
          )
            return;
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(event.data);
        };
        window.addEventListener('message', onMessage);
        window.postMessage(
          {
            type: 'HHR_RAYEN_PATIENT_CLINICAL_BUNDLE_REQUEST',
            reqId,
            encId: '141121',
            fecha: clinicalDay,
            acceptEntries: true,
            lookbackDays: 7,
          },
          window.location.origin
        );
      }),
    fecha
  );

const temp = await mkdtemp(path.join(os.tmpdir(), 'hhr-extension-upgrade-'));
const extensionPath = path.join(temp, 'extension');
let context;
try {
  const archive = execFileSync('git', ['archive', PREVIOUS_REF, 'extension'], {
    cwd: ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  const archivePath = path.join(temp, 'previous.tar');
  await writeFile(archivePath, archive);
  execFileSync('tar', ['-xf', archivePath, '-C', temp]);
  const previousManifest = JSON.parse(
    await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')
  );
  assert.equal(previousManifest.version, '0.48.32', 'The pinned previous tree changed');
  assert.notEqual(previousManifest.version, currentManifest.version);

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const oldWorker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extensionId = new URL(oldWorker.url()).host;

  await context.route('https://fichamedico.rayensalud.cl/**', route =>
    route.request().url().includes('/api/auth/session')
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: syntheticSession,
        })
      : route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml('Ficha sintetica'),
        })
  );
  await context.route('https://hospitalizado.rayensalud.cl/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('Camas sinteticas') })
  );
  await context.route('http://localhost:3001/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml('HHR sintetico') })
  );
  // No test request may reach Eloísa's real clinical backend.
  await context.route('https://fichamedicoback.rayensalud.cl/**', route => route.abort());

  const [ficha, camas, hhr] = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  await Promise.all([
    ficha.goto(fixtureUrl),
    camas.goto('https://hospitalizado.rayensalud.cl/#/bed'),
    hhr.goto('http://localhost:3001/census'),
  ]);
  await Promise.all([
    ficha.waitForFunction(() => document.documentElement.dataset.rayenRelay === '1'),
    camas.waitForFunction(() => document.documentElement.dataset.rayenGcRelay === '1'),
  ]);
  const oldStatus = await context.newPage();
  await oldStatus.goto(`chrome-extension://${extensionId}/extension-status.html`);
  const oldRuntime = await runtimeContext(oldStatus);
  assert.equal(oldRuntime.version, previousManifest.version);
  const initialDeadline = Date.now() + 15_000;
  let before;
  do {
    before = await relayHealth(oldStatus);
    if ([before.ficha, before.camas, before.hhr].every(source => source?.ready === true)) break;
    await oldStatus.waitForTimeout(200);
  } while (Date.now() < initialDeadline);
  assert.equal(before.ficha.ready, true);
  assert.equal(before.camas.ready, true);
  assert.equal(before.hhr.ready, true);
  await oldStatus.close();

  await ficha
    .locator('#hhr-clinical-operations-bar')
    .waitFor({ state: 'attached', timeout: 10_000 });
  await ficha.locator('#hhr-clinical-operations-bar .hhr-ops-session').click();
  await ficha.waitForFunction(
    () =>
      document.querySelector('#hhr-prescription-print-modal')?.dataset.activeModule === 'connection'
  );

  const sentinel = `original-documents-${Date.now()}`;
  await ficha.evaluate(() => {
    document.querySelector('#hhr-clinical-operations-bar').dataset.upgradeSentinel = 'old-bar';
  });
  await Promise.all(
    [ficha, camas, hhr].map(page =>
      page.evaluate(value => {
        window.__hhrUpgradeDocumentSentinel = value;
      }, sentinel)
    )
  );

  // Keep the unpacked extension path (and therefore its Chrome identity) stable.
  // Only its package contents change before Chrome's actual reload control runs.
  await rm(extensionPath, { recursive: true, force: true });
  await cp(SOURCE_EXTENSION, extensionPath, { recursive: true });
  const extensionsPage = await context.newPage();
  await extensionsPage.goto('chrome://extensions/');
  const developerMode = extensionsPage.locator('extensions-manager extensions-toolbar #devMode');
  if ((await developerMode.getAttribute('aria-pressed')) !== 'true') await developerMode.click();
  await extensionsPage.locator(`extensions-item#${extensionId} #dev-reload-button`).click();

  const status = await context.newPage();
  const statusUrl = `chrome-extension://${extensionId}/extension-status.html`;
  const deadline = Date.now() + 25_000;
  let after;
  while (Date.now() < deadline) {
    try {
      await status.goto(statusUrl);
      after = await relayHealth(status);
      if (
        after.runtime?.version === currentManifest.version &&
        after.ficha?.ready === true &&
        after.camas?.ready === true &&
        after.hhr?.ready === true
      )
        break;
    } catch (_error) {
      // The first request can race Chrome's replacement worker registration.
    }
    await status.waitForTimeout(200);
  }
  assert.equal(after?.runtime?.version, currentManifest.version);
  for (const source of ['ficha', 'camas', 'hhr']) {
    assert.equal(after[source]?.ready, true, `${source} did not recover after version upgrade`);
    assert.notEqual(after[source]?.reason, 'outdated_tab');
  }
  assert.equal(
    after.runtime.runtimeGeneration,
    oldRuntime.runtimeGeneration,
    'The surviving MAIN readers lost their compatible runtime generation'
  );
  assert.deepEqual(
    await Promise.all(
      [ficha, camas, hhr].map(page => page.evaluate(() => window.__hhrUpgradeDocumentSentinel))
    ),
    [sentinel, sentinel, sentinel],
    'An open document reloaded during the version upgrade'
  );
  await ficha
    .locator('#hhr-clinical-operations-bar')
    .waitFor({ state: 'attached', timeout: 10_000 });
  assert.equal(await ficha.locator('#hhr-clinical-operations-bar').count(), 1);
  assert.equal(
    await ficha.locator('#hhr-clinical-operations-bar').getAttribute('data-upgrade-sentinel'),
    null,
    'The old Ficha operations bar survived the extension upgrade'
  );
  assert.equal(
    await ficha.locator('#hhr-clinical-operations-bar').getAttribute('data-hhr-ui-build-version'),
    currentManifest.version
  );
  await ficha.waitForFunction(() => !document.querySelector('#hhr-prescription-print-modal'));
  await ficha.locator('#hhr-clinical-operations-bar .hhr-ops-session').click();
  await ficha.waitForFunction(
    () =>
      document.querySelector('.hhr-connection-extension .hhr-connection-status')?.textContent ===
      'Conectado',
    undefined,
    { timeout: 10_000 }
  );

  const newWorker = context
    .serviceWorkers()
    .find(worker => worker !== oldWorker && new URL(worker.url()).host === extensionId);
  assert.ok(newWorker, 'Chrome did not register a replacement worker');
  await newWorker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://fichamedicoback.rayensalud.cl/')) {
        return originalFetch(input, init);
      }
      if (
        [
          '/invasiveDeviceEntry/',
          '/getPatientEncounterHistoryReportServer/',
          '/encounterFormEntry/',
        ].some(segment => url.includes(segment))
      ) {
        return Promise.resolve(
          new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      throw new Error('Unexpected synthetic clinical endpoint');
    };
  });
  const day = await newWorker.evaluate(() => HhrClinicalDayRuntime.clinicalDayAt(new Date()));
  const bundle = await clinicalBundle(hhr, day);
  assert.equal(bundle.error, undefined);
  for (const section of ['devices', 'history', 'forms']) {
    assert.equal(bundle[section]?.error, undefined, `${section} did not survive the upgrade`);
  }
  assert.ok(Array.isArray(bundle.devices?.entries));
  assert.ok(Array.isArray(bundle.history?.events));
  assert.ok(Array.isArray(bundle.forms?.forms));
  console.log(
    `Cross-version extension smoke passed (${previousManifest.version} -> ${currentManifest.version}).`
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
