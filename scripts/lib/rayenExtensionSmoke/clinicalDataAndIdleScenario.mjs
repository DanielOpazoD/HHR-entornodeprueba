import assert from 'node:assert/strict';

import {
  FIXTURE_URL,
  HHR_FIXTURE_URL,
  diagnoseFichaReader,
  installSyntheticClinicalBackend,
  readRelayHealth,
  removeMainBridgeListener,
  requestClinicalBundle,
  requestHhrHealth,
  requestInvalidPatientFlow,
  terminateWorker,
} from './runtimeHelpers.mjs';

export const verifyClinicalDataAndSessionLifecycle = async ({
  context,
  reloadedWorker,
  reloadedStatusPage,
  hhrPage,
  setSessionExpired,
}) => {
  // A green relay is insufficient: exercise the entire data path through HHR's page bridge,
  // the replacement MV3 worker, the surviving Ficha session, and all three clinical readers.
  await installSyntheticClinicalBackend(reloadedWorker);
  const syntheticClinicalDate = await reloadedWorker.evaluate(() =>
    HhrClinicalDayRuntime.clinicalDayAt(new Date())
  );
  assert.match(syntheticClinicalDate || '', /^20\d\d-\d\d-\d\d$/);
  const unauthorizedBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  assert.match(unauthorizedBundle.forms?.error || '', /no fueron autorizadas/);
  assert.equal(
    await reloadedWorker.evaluate(() =>
      globalThis.__hhrSyntheticClinicalRequests.some(url => url.includes('/encounterFormEntry/'))
    ),
    false,
    'Unauthorized scales must not reach the clinical backend'
  );
  await reloadedWorker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab) throw new Error('Synthetic HHR tab is unavailable');
    await patientFlowRuntime.authorizeSnapshotResponse(
      { tab, url, origin: new URL(url).origin },
      Promise.resolve({ snapshot: { encounters: [{ encounterId: '141121' }] } })
    );
  }, HHR_FIXTURE_URL);
  const clinicalBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  assert.equal(clinicalBundle.error, undefined);
  for (const section of ['devices', 'history', 'forms']) {
    assert.equal(clinicalBundle[section]?.error, undefined, `${section} was not readable`);
  }
  assert.equal(clinicalBundle.devices?.source, 'json');
  assert.ok(Array.isArray(clinicalBundle.devices?.entries));
  assert.ok(Array.isArray(clinicalBundle.history?.events));
  assert.ok(Array.isArray(clinicalBundle.forms?.forms));
  const backendRequests = await reloadedWorker.evaluate(
    () => globalThis.__hhrSyntheticClinicalRequests || []
  );
  assert.ok(backendRequests.some(url => url.includes('/invasiveDeviceEntry/')));
  assert.ok(backendRequests.some(url => url.includes('/getPatientEncounterHistoryReportServer/')));
  assert.ok(backendRequests.some(url => url.includes('/encounterFormEntry/')));

  const dauPreflight = await reloadedWorker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    const sender = { tab, url, origin: new URL(url).origin };
    const before = globalThis.__hhrSyntheticClinicalRequests.length;
    const result = await runtimeMessageRoutes[RUNTIME_MESSAGES.CLINICAL_ANTECEDENTS_REQUEST].handle(
      { encId: '141121', operation: 'dau', entryId: 'Primaria:8' },
      sender
    );
    const unchanged = globalThis.__hhrSyntheticClinicalRequests.length === before;
    await urgencyAuth.revoke(sender);
    return {
      loginPrepared: Boolean(result?.auth?.flowId),
      noClinicalReads: unchanged,
      opened: result.opened === true,
    };
  }, HHR_FIXTURE_URL);
  assert.deepEqual(dauPreflight, { loginPrepared: true, noClinicalReads: true, opened: false });
  console.log('[DAU] missing native session prompts for login before any HCC clinical read');

  const revocation = await reloadedWorker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    const sender = { tab, url, origin: new URL(url).origin };
    await patientFlowRuntime.authorizationReady;
    patientFlowRuntime.authorizeVerifiedEncounter(sender, '141121');
    const before = patientFlowRuntime.isAuthorized(sender, '141121');
    const original = urgencyAuth.revoke;
    let failed = false;
    try {
      urgencyAuth.revoke = async () => {
        throw new Error('Synthetic native cleanup failure');
      };
      try {
        await runtimeMessageRoutes[RUNTIME_MESSAGES.HHR_SESSION_CHANGED].handle({}, sender);
      } catch {
        failed = true;
      }
      return { before, after: patientFlowRuntime.isAuthorized(sender, '141121'), failed };
    } finally {
      urgencyAuth.revoke = original;
      await patientFlowRuntime.authorizeSnapshotResponse(
        sender,
        Promise.resolve({
          snapshot: { encounters: [{ encounterId: '141121' }] },
        })
      );
    }
  }, HHR_FIXTURE_URL);
  assert.deepEqual(
    revocation,
    { before: true, after: false, failed: true },
    'Native cleanup failure must not prevent clinical authorization revocation'
  );

  // A tab with a closed session must not displace another usable Ficha tab.
  const staleFichaPage = await context.newPage();
  await staleFichaPage.goto(`${FIXTURE_URL}?stale-session=1`);
  await staleFichaPage.waitForFunction(() => document.documentElement.dataset.rayenRelay === '1');
  const multiTabHealth = await readRelayHealth(reloadedStatusPage);
  assert.equal(multiTabHealth.fichaMedico.ready, true);
  const multiTabBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  assert.equal(multiTabBundle.devices?.error, undefined);
  assert.equal(multiTabBundle.history?.error, undefined);
  assert.equal(multiTabBundle.forms?.error, undefined);

  // A verified session alone cannot establish clinical availability. Model the observed
  // "green connection, no clinical data" failure, then recover without reloading tabs.
  await reloadedWorker.evaluate(() => {
    globalThis.__hhrSyntheticBackendMode = 'http-503';
  });
  const unavailableBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  for (const section of ['devices', 'history', 'forms']) {
    assert.ok(unavailableBundle[section]?.error, `${section} must fail explicitly on HTTP 503`);
  }
  const greenDuringOutage = await readRelayHealth(reloadedStatusPage);
  assert.equal(greenDuringOutage.fichaMedico.ready, true);
  await reloadedWorker.evaluate(() => {
    globalThis.__hhrSyntheticBackendMode = 'ok';
  });
  const recoveredBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  for (const section of ['devices', 'history', 'forms']) {
    assert.equal(recoveredBundle[section]?.error, undefined, `${section} did not recover`);
  }

  setSessionExpired(true);
  const expiredHealth = await readRelayHealth(reloadedStatusPage);
  assert.equal(expiredHealth.fichaMedico.ready, false);
  const expiredPreflight = await requestHhrHealth(hhrPage, { verifySessions: true });
  assert.equal(expiredPreflight.report.syncPreflight, true);
  assert.notEqual(expiredPreflight.report.fichaMedico.status, 'ready');
  const expiredBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  for (const section of ['devices', 'history', 'forms']) {
    assert.ok(expiredBundle[section]?.error, `${section} must reject an expired session`);
  }
  setSessionExpired(false);
  const renewedHealth = await readRelayHealth(reloadedStatusPage);
  assert.equal(renewedHealth.fichaMedico.ready, true);
  const renewedBundle = await requestClinicalBundle(hhrPage, syntheticClinicalDate);
  for (const section of ['devices', 'history', 'forms']) {
    assert.equal(
      renewedBundle[section]?.error,
      undefined,
      `${section} did not read after session renewal`
    );
  }
  await staleFichaPage.close();
};

export const verifyMainProbeUpgradeAndIdleCycles = async ({
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
}) => {
  // An already-open compatible MAIN reader may predate the new bridge probe. Re-injecting
  // the current MAIN entry must add that probe while retaining the existing reader/session.
  const removedMainProbe = await page.evaluate(() => {
    const key = '__hhrFichaMainPingListenerV1';
    const listener = window[key];
    if (typeof listener !== 'function') return false;
    window.removeEventListener('message', listener);
    delete window[key];
    return true;
  });
  assert.equal(removedMainProbe, true, 'Could not simulate a compatible pre-probe MAIN reader');
  const fichaMainFiles = manifest.content_scripts.find(
    entry => entry.world === 'MAIN' && entry.js.includes('inject-fichamedico.js')
  )?.js;
  assert.ok(fichaMainFiles, 'Ficha MAIN manifest entry is missing');
  await reloadedStatusPage.evaluate(async files => {
    const [tab] = await chrome.tabs.query({ url: 'https://fichamedico.rayensalud.cl/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files });
  }, fichaMainFiles);
  const upgradedMain = await readRelayHealth(reloadedStatusPage);
  assert.equal(
    upgradedMain.fichaMedico.ready,
    true,
    'A compatible older MAIN reader did not gain the probe after reinjection'
  );

  // Repeat the idle → resumed-tab path. The optional delay supports a real multi-minute
  // local soak without adding four minutes to every CI run.
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    if (cycle === 2) {
      // A live ISOLATED listener can mask a missing MAIN listener. The next tab activation
      // must discover and restore that inner reader rather than trusting the outer relay.
      await removeMainBridgeListener(context, page, 'Ficha Medico after idle');
    }
    await terminateWorker(context, reloadedStatusPage, extensionId);
    if (idleDelayMs) await new Promise(resolve => setTimeout(resolve, idleDelayMs));
    // Resume actual tab use after the pause, rather than waking the worker only from its
    // extension page. These activations exercise the restored-tab repair listener too.
    await page.bringToFront();
    await gestionCamasPage.bringToFront();
    await hhrPage.bringToFront();
    let resumedHealth;
    let lastResumeError;
    // Match HHR's bounded pre-sync health budget under a busy test runner.
    const resumeStartedAt = Date.now();
    const resumeDeadline = resumeStartedAt + 25_000;
    while (Date.now() < resumeDeadline) {
      try {
        resumedHealth = await readRelayHealth(reloadedStatusPage);
        if (
          resumedHealth?.fichaMedico?.ready &&
          resumedHealth?.gestionCamas?.ready &&
          resumedHealth?.hhr?.ready
        )
          break;
      } catch (error) {
        // Chrome may still be registering the replacement worker.
        lastResumeError = String(error);
      }
      await reloadedStatusPage.waitForTimeout(150);
    }
    const resumeDiagnostic = JSON.stringify({
      runtimeGeneration: resumedHealth?.runtimeContext?.runtimeGeneration,
      fichaMedico: resumedHealth?.fichaMedico,
      gestionCamas: resumedHealth?.gestionCamas,
      hhr: resumedHealth?.hhr,
      lastResumeError,
    });
    if (resumedHealth?.fichaMedico?.ready !== true) {
      const directReader = await diagnoseFichaReader(page).catch(error => ({
        error: String(error),
      }));
      console.error(`[idle] cycle ${cycle} MAIN diagnostic: ${JSON.stringify(directReader)}`);
    }
    assert.equal(
      resumedHealth?.fichaMedico?.ready,
      true,
      `Ficha did not resume in cycle ${cycle}: ${resumeDiagnostic}`
    );
    assert.equal(
      resumedHealth?.gestionCamas?.ready,
      true,
      `Camas did not resume in cycle ${cycle}`
    );
    assert.equal(resumedHealth?.hhr?.ready, true, `HHR did not resume in cycle ${cycle}`);
    assert.equal(resumedHealth.runtimeContext.runtimeGeneration, runtimeContext.runtimeGeneration);
    console.log(`[idle] cycle ${cycle}: three relays ready in ${Date.now() - resumeStartedAt} ms`);
    assert.equal(
      await page.locator('#hhr-clinical-operations-bar').count(),
      1,
      `Ficha controls duplicated after idle cycle ${cycle}`
    );
    // A runtime-context answer proves the worker woke; Playwright versions before its
    // MV3 target-reuse fix retain a stale Worker handle after CDP terminates that target.
    const resumedPageHealth = await requestHhrHealth(hhrPage);
    assert.equal(resumedPageHealth.report?.hhr?.status, 'ready');
    const resumedPageRoute = await requestInvalidPatientFlow(hhrPage);
    assert.match(resumedPageRoute.error || '', /episodio clínico no es válido/);
    assert.deepEqual(
      await Promise.all(
        [page, gestionCamasPage, hhrPage].map(fixturePage =>
          fixturePage.evaluate(() => window.__hhrExtensionUpdateDocumentSentinel)
        )
      ),
      [documentSentinel, documentSentinel, documentSentinel]
    );
  }

  return fichaMainFiles;
};

export const verifyProbeAndGcReceiverRepair = async ({
  context,
  page,
  hhrPage,
  reloadedStatusPage,
  fichaMainFiles,
  runtimeContext,
  documentSentinel,
}) => {
  // A lost probe listener is different from a retained reader that answered but could not
  // prove compatibility. Activation must reinstall the probe instead of failing closed.
  const removedFichaProbe = await page.evaluate(() => {
    const key = '__hhrFichaMainPingListenerV1';
    const listener = window[key];
    if (typeof listener !== 'function') return false;
    window.removeEventListener('message', listener);
    delete window[key];
    return true;
  });
  assert.equal(removedFichaProbe, true, 'Could not simulate a lost Ficha MAIN probe');
  await page.bringToFront();
  let repairedFichaProbe;
  const probeDeadline = Date.now() + 15_000;
  while (Date.now() < probeDeadline) {
    repairedFichaProbe = await reloadedStatusPage.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://fichamedico.rayensalud.cl/*' });
      return chrome.tabs.sendMessage(tab.id, { type: 'RAYEN_EXTENSION_MAIN_PING' });
    });
    if (repairedFichaProbe?.mainReady === true) break;
    await reloadedStatusPage.waitForTimeout(250);
  }
  assert.equal(
    repairedFichaProbe?.mainReady,
    true,
    'Activation did not reinstall a missing Ficha MAIN probe'
  );
  assert.equal(
    await page.evaluate(() => window.__hhrExtensionUpdateDocumentSentinel),
    documentSentinel,
    'Ficha document reloaded while repairing its probe'
  );

  // Other listeners may survive in ISOLATED even when the GC health receiver disappears.
  // In that case tabs.sendMessage can resolve without a health response instead of throwing.
  const removedGcReceiver = await reloadedStatusPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://hospitalizado.rayensalud.cl/*' });
    if (!Number.isInteger(tab?.id)) return false;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const relay = globalThis.__hhrGestionCamasRelayInstalled;
        if (!relay?.runtimeListener) return false;
        chrome.runtime.onMessage.removeListener(relay.runtimeListener);
        return true;
      },
    });
    return results.some(result => result.result === true);
  });
  assert.equal(removedGcReceiver, true, 'Could not simulate an orphaned GC health receiver');
  await reloadedStatusPage.waitForTimeout(3_100); // health cache TTL
  const repairedGcHealth = await reloadedStatusPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'RAYEN_EXTENSION_HEALTH_REQUEST' })
  );
  assert.equal(
    repairedGcHealth.gestionCamas.bridgeGeneration,
    runtimeContext.runtimeGeneration,
    'GC did not repair its missing health receiver without foregrounding the tab'
  );
  const relayHealthAfterRepair = await readRelayHealth(reloadedStatusPage);
  assert.equal(relayHealthAfterRepair.gestionCamas.ready, true);
  const invalidPatientFlow = await requestInvalidPatientFlow(hhrPage);
  assert.equal(invalidPatientFlow.base64, '');
  assert.match(
    invalidPatientFlow.error,
    /episodio clínico no es válido/,
    'The reloaded HHR document did not recover its patient-flow helper'
  );

  // A new probe must not certify an incompatible retained MAIN reader merely because
  // that reader exposes a reactivation function.
  await removeMainBridgeListener(context, page, 'incompatible Ficha MAIN reader');
  await page.evaluate(() => {
    const incompatibleReader = event => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'RAYEN_FM_SESSION_STATUS_REQUEST'
      )
        return;
      window.postMessage(
        {
          type: 'RAYEN_FM_SESSION_STATUS_RESULT',
          reqId: event.data.reqId,
          bridgeProtocolVersion: 0,
          bridgeGeneration: window.__hhrExtensionRuntimeGenerationV1__,
          ready: false,
        },
        window.location.origin
      );
    };
    window.__rayenBridgeInjected = {
      reactivate: () => {
        window.removeEventListener('message', incompatibleReader);
        window.addEventListener('message', incompatibleReader);
      },
    };
    // A persistent marker from an older injection must not certify this reader.
    window.__hhrFichaMainReaderProtocolV1 = {
      reader: window.__rayenBridgeInjected,
      protocolVersion: 1,
    };
  });
  await reloadedStatusPage.evaluate(async files => {
    const [tab] = await chrome.tabs.query({ url: 'https://fichamedico.rayensalud.cl/*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files });
  }, fichaMainFiles);
  const incompatibleProbe = await reloadedStatusPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://fichamedico.rayensalud.cl/*' });
    return chrome.tabs.sendMessage(tab.id, { type: 'RAYEN_EXTENSION_MAIN_PING' });
  });
  assert.equal(
    incompatibleProbe?.mainReady,
    false,
    'The new probe falsely certified an incompatible retained MAIN reader'
  );
  assert.equal(incompatibleProbe?.reason, 'incompatible_reader');
};
