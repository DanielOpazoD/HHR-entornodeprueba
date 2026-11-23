import assert from 'node:assert/strict';

import {
  APPROVED_HHR_ORIGINS,
  GESTION_CAMAS_FIXTURE_URL,
  HHR_FIXTURE_URL,
  UNRELATED_ORIGINS,
  minimalFixtureHtml,
  readRelayHealth,
  removeMainBridgeListener,
  requestHhrHealth,
  requestInvalidPatientFlow,
} from './runtimeHelpers.mjs';

export const verifyExtensionReloadRecovery = async ({
  context,
  page,
  serviceWorker,
  extensionId,
  runtimeContext,
  artifact,
  runtimeErrors,
}) => {
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
  await gestionCamasPage.goto(GESTION_CAMAS_FIXTURE_URL);
  await hhrPage.goto(HHR_FIXTURE_URL);
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
  const recoveryDeadline = Date.now() + 25_000;
  while (Date.now() < recoveryDeadline) {
    try {
      recoveredHealth = await readRelayHealth(reloadedStatusPage);
    } catch {
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
  assert.equal(recoveredHealth.fichaMedico.ready, true, 'A verified Ficha session must recover');

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
  assert.equal(hhrHealthResult.report.buildId, artifact.buildId);
  assert.equal(hhrHealthResult.report.runtimeGeneration, runtimeContext.runtimeGeneration);
  assert.equal(hhrHealthResult.report.hhr.status, 'ready');
  assert.equal(
    hhrHealthResult.report.gestionCamas.bridgeGeneration,
    runtimeContext.runtimeGeneration
  );
  assert.notEqual(hhrHealthResult.report.gestionCamas.reason, 'outdated_tab');
  assert.notEqual(hhrHealthResult.report.fichaMedico.reason, 'outdated_tab');
  assert.equal(hhrHealthResult.report.fichaMedico.status, 'ready');

  return {
    gestionCamasPage,
    hhrPage,
    extensionsPage,
    reloadedStatusPage,
    reloadedWorker,
    documentSentinel,
  };
};

export const verifyGestionCamasPreflight = async ({
  reloadedWorker,
  reloadedStatusPage,
  hhrPage,
}) => {
  // Exercise the packaged HHR → ISOLATED → MV3 preflight contract with a fresh cached
  // green report. A revoked GC connection must bypass that report and its 15-minute lease.
  await reloadedWorker.evaluate(async () => {
    const [sourceTab] = await chrome.tabs.query({ url: 'https://hospitalizado.rayensalud.cl/*' });
    const record = HhrGestionCamasSession.buildSessionRecord({
      token: 'test-token-placeholder',
      apiBase: 'https://hospbackend.rayensalud.cl',
      facId: '1',
    });
    await chrome.storage.session.set({
      [HhrGestionCamasSession.SESSION_STORAGE_KEY]: {
        ...record,
        sourceTabId: sourceTab.id,
        lastVerifiedAt: Date.now(),
      },
    });
    globalThis.__hhrGcProbeRequests = 0;
    globalThis.__hhrGcProbeAvailable = true;
    globalThis.__hhrGcOriginalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (!String(input).startsWith('https://hospbackend.rayensalud.cl/'))
        return globalThis.__hhrGcOriginalFetch(input, init);
      globalThis.__hhrGcProbeRequests += 1;
      return Promise.resolve(
        new Response('[]', {
          status: globalThis.__hhrGcProbeAvailable ? 200 : 503,
        })
      );
    };
  });
  try {
    const verifiedHealth = await requestHhrHealth(hhrPage, { verifySessions: true });
    assert.equal(verifiedHealth.report.syncPreflight, true);
    assert.ok(verifiedHealth.report.capabilities.includes('sync-preflight-verification'));
    assert.equal(verifiedHealth.report.fichaMedico.status, 'ready');
    assert.equal(verifiedHealth.report.gestionCamas.status, 'ready');
    const verifiedRequests = await reloadedWorker.evaluate(() => globalThis.__hhrGcProbeRequests);
    assert.ok(verifiedRequests >= 1, 'An action preflight did not verify GC remotely');

    await reloadedWorker.evaluate(() => {
      globalThis.__hhrGcProbeAvailable = false;
    });
    const cachedGreen = await requestHhrHealth(hhrPage);
    assert.equal(cachedGreen.report.gestionCamas.status, 'ready');
    assert.equal(
      cachedGreen.report.syncPreflight,
      false,
      'A passive reply reused the action acknowledgment'
    );
    assert.equal(
      await reloadedWorker.evaluate(() => globalThis.__hhrGcProbeRequests),
      verifiedRequests
    );

    const rejectedPreflight = await requestHhrHealth(hhrPage, { verifySessions: true });
    assert.equal(rejectedPreflight.report.syncPreflight, true);
    assert.equal(rejectedPreflight.report.fichaMedico.status, 'ready');
    assert.equal(rejectedPreflight.report.gestionCamas.status, 'stale');
    assert.ok(
      (await reloadedWorker.evaluate(() => globalThis.__hhrGcProbeRequests)) > verifiedRequests,
      'The action preflight trusted the cached green session instead of checking the backend'
    );
    const blockedPassive = await requestHhrHealth(hhrPage);
    assert.equal(blockedPassive.report.gestionCamas.status, 'stale');
    assert.equal(blockedPassive.report.syncPreflight, false);

    const persistedVerification = await reloadedStatusPage.evaluate(async () => {
      const key = 'hhrGestionCamasSessionV1';
      const record = (await chrome.storage.session.get(key))[key];
      return { lastVerifiedAt: record?.lastVerifiedAt, epoch: record?.verificationEpoch };
    });
    assert.equal(
      persistedVerification.lastVerifiedAt,
      null,
      'A failed action probe retained its green lease in canonical session storage'
    );
    assert.ok(Number.isSafeInteger(persistedVerification.epoch) && persistedVerification.epoch > 0);

    await reloadedWorker.evaluate(() => {
      globalThis.__hhrGcProbeAvailable = true;
    });
    const recoveredPreflight = await requestHhrHealth(hhrPage, { verifySessions: true });
    assert.equal(recoveredPreflight.report.syncPreflight, true);
    assert.equal(recoveredPreflight.report.fichaMedico.status, 'ready');
    assert.equal(recoveredPreflight.report.gestionCamas.status, 'ready');
    console.log(
      '[preflight] cached green bypassed, disconnected GC blocked, verified recovery ready'
    );
  } finally {
    await reloadedWorker.evaluate(async () => {
      await chrome.storage.session.remove(HhrGestionCamasSession.SESSION_STORAGE_KEY);
      globalThis.fetch = globalThis.__hhrGcOriginalFetch;
      delete globalThis.__hhrGcOriginalFetch;
    });
  }
};

export const verifyOriginMatrix = async ({ context, manifest, reloadedStatusPage }) => {
  // Published sites must receive the real manifest-declared content scripts too.
  // Fulfill all page traffic locally: never contact the deployed clinical application.
  for (const origin of APPROVED_HHR_ORIGINS) {
    await context.route(`${origin}/**`, route =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: minimalFixtureHtml('HHR publicado sintetico'),
      })
    );
    const publishedPage = await context.newPage();
    try {
      await publishedPage.goto(`${origin}/census`);
      const health = await requestHhrHealth(publishedPage);
      assert.equal(health.error, undefined, `${origin} health bridge did not respond`);
      assert.equal(health.report.version, manifest.version);
      assert.equal(health.report.hhr.status, 'ready');
      const flow = await requestInvalidPatientFlow(publishedPage);
      assert.match(flow.error || '', /episodio clínico no es válido/);
    } finally {
      await publishedPage.close();
    }
  }

  for (const origin of UNRELATED_ORIGINS) {
    await context.route(`${origin}/**`, route =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: minimalFixtureHtml('Origen no HHR'),
      })
    );
    const unrelatedPage = await context.newPage();
    try {
      await unrelatedPage.goto(`${origin}/census`);
      const answered = await reloadedStatusPage.evaluate(async url => {
        const tab = (await chrome.tabs.query({})).find(candidate => candidate.url === url);
        if (!Number.isInteger(tab?.id)) throw new Error('Missing negative origin fixture tab');
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'RAYEN_EXTENSION_RELAY_PING' });
          return true;
        } catch {
          return false;
        }
      }, `${origin}/census`);
      assert.equal(answered, false, `${origin} installed an unauthorized HHR relay`);
    } finally {
      await unrelatedPage.close();
    }
  }
  console.log('[origins] 51 approved HHR origins connected; six unrelated origins have no relay');
};
