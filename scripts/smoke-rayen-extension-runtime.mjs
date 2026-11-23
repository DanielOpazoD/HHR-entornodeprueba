import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

import { chromium } from 'playwright';

import {
  installSyntheticFixtureRoutes,
  verifyInitialOperationsBarAndRouteIsolation,
  verifyStatusPageAndRuntimeContext,
} from './lib/rayenExtensionSmoke/clinicalOperationsScenario.mjs';
import {
  verifyExtensionReloadRecovery,
  verifyGestionCamasPreflight,
  verifyOriginMatrix,
} from './lib/rayenExtensionSmoke/updateAndPreflightScenario.mjs';
import {
  verifyClinicalDataAndSessionLifecycle,
  verifyMainProbeUpgradeAndIdleCycles,
  verifyProbeAndGcReceiverRepair,
} from './lib/rayenExtensionSmoke/clinicalDataAndIdleScenario.mjs';
import { unpackExtensionArtifact } from './lib/rayenExtensionSmoke/runtimeHelpers.mjs';

const { packageDirectory, extensionPath, artifact, manifest } = await unpackExtensionArtifact(
  process.cwd()
);

const idleDelayMs = Number(process.env.HHR_EXTENSION_IDLE_WAIT_MS || 0);
assert.ok(
  Number.isInteger(idleDelayMs) && idleDelayMs >= 0 && idleDelayMs <= 180_000,
  'HHR_EXTENSION_IDLE_WAIT_MS must be between 0 and 180000'
);

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

  const runtimeContext = await verifyStatusPageAndRuntimeContext({
    context,
    extensionId,
    manifest,
    runtimeErrors,
  });

  let sessionExpired = false;
  await installSyntheticFixtureRoutes({
    context,
    getSessionExpired: () => sessionExpired,
  });

  const page = await verifyInitialOperationsBarAndRouteIsolation({
    context,
    manifest,
    runtimeErrors,
  });

  const {
    gestionCamasPage,
    hhrPage,
    extensionsPage,
    reloadedStatusPage,
    reloadedWorker,
    documentSentinel,
  } = await verifyExtensionReloadRecovery({
    context,
    page,
    serviceWorker,
    extensionId,
    runtimeContext,
    artifact,
    runtimeErrors,
  });

  await verifyGestionCamasPreflight({ reloadedWorker, reloadedStatusPage, hhrPage });
  await verifyOriginMatrix({ context, manifest, reloadedStatusPage });

  await verifyClinicalDataAndSessionLifecycle({
    context,
    reloadedWorker,
    reloadedStatusPage,
    hhrPage,
    setSessionExpired: value => {
      sessionExpired = value;
    },
  });

  const fichaMainFiles = await verifyMainProbeUpgradeAndIdleCycles({
    context,
    page,
    gestionCamasPage,
    hhrPage,
    reloadedStatusPage,
    extensionId,
    manifest,
    runtimeContext,
    documentSentinel,
    idleDelayMs,
  });

  await verifyProbeAndGcReceiverRepair({
    context,
    page,
    hhrPage,
    reloadedStatusPage,
    fichaMainFiles,
    runtimeContext,
    documentSentinel,
  });

  await reloadedStatusPage.close();
  await extensionsPage.close();

  const unexpectedRuntimeErrors = runtimeErrors.filter(
    error =>
      !error.endsWith(
        'Failed to load resource: the server responded with a status of 401 (Unauthorized)'
      )
  );
  assert.deepEqual(
    unexpectedRuntimeErrors,
    [],
    `Unexpected runtime errors:\n${unexpectedRuntimeErrors.join('\n')}`
  );
  console.log(
    `Rayen extension runtime smoke passed (MV3 v${manifest.version}, update recovery, live clinical bridge simulation, reinjection, limits, route isolation).`
  );
} finally {
  await context.close();
  await rm(packageDirectory, { recursive: true, force: true });
}
