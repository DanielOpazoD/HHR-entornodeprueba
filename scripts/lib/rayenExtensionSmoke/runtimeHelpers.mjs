import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';
import { packageRayenExtension } from '../../config/extensionDownloadPlugin.ts';

export const FIXTURE_URL =
  'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141121';
export const GESTION_CAMAS_FIXTURE_URL = 'https://hospitalizado.rayensalud.cl/#/bed';
export const HHR_FIXTURE_URL = 'http://localhost:3001/census';

export const SYNTHETIC_SESSION = {
  ok: true,
  session: {
    token: 'fixture',
    facilityId: '1',
    healthCarePractitionerId: '2',
    healthCarePractitionerRoleId: '3',
    role: 'Enfermera',
    fullName: 'Profesional de prueba',
  },
};

export const FIXTURE_HTML = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Ficha clinica sintetica</title></head>
  <body><main><h2>Farmacos</h2></main></body>
</html>`;

export const minimalFixtureHtml = title => `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>${title}</title></head>
  <body><main><h1>${title}</h1></main></body>
</html>`;

export const APPROVED_HHR_ORIGINS = [
  ...['localhost', '127.0.0.1'].flatMap(host =>
    Array.from({ length: 21 }, (_, index) => `http://${host}:${3000 + index}`)
  ),
  'https://hhr-hospitalizados.app',
  'https://testinghhr.netlify.app',
  'https://hhr-entorno-prueba.netlify.app',
  ...['testinghhr', 'hhr-entorno-prueba'].flatMap(site => [
    `https://deploy-preview-992--${site}.netlify.app`,
    `https://feature-origins--${site}.netlify.app`,
    `https://0123456789abcdef01234567--${site}.netlify.app`,
  ]),
];

export const UNRELATED_ORIGINS = [
  'http://localhost:2999',
  'http://localhost:3021',
  'http://127.0.0.1:3021',
  'https://unrelated.netlify.app',
  'https://deploy-preview-992--unrelated.netlify.app',
  'https://deploy-preview-992--testinghhr-evil.netlify.app',
];

export const unpackExtensionArtifact = async cwd => {
  const packageDirectory = await mkdtemp(path.join(os.tmpdir(), 'hhr-extension-runtime-'));
  const extensionPath = path.join(packageDirectory, 'extension');
  const artifact = packageRayenExtension(cwd);
  for (const [name, bytes] of Object.entries(unzipSync(artifact.zip))) {
    const file = path.join(extensionPath, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  return { packageDirectory, extensionPath, artifact, manifest };
};

export const requestRuntimeContext = statusPage =>
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

export const diagnoseFichaReader = page =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const reqId = `reader-diagnostic-${Date.now()}`;
        const details = {
          readerPresent: typeof window.__rayenBridgeInjected?.reactivate === 'function',
          probePresent: typeof window.__hhrFichaMainPingListenerV1 === 'function',
          bridgeGeneration: String(window.__hhrExtensionRuntimeGenerationV1__ || ''),
        };
        const onMessage = event => {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.type !== 'RAYEN_FM_BRIDGE_PONG' ||
            event.data?.reqId !== reqId
          )
            return;
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve({ ...details, directReply: event.data?.mainReady === true });
        };
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          resolve({ ...details, directReply: false });
        }, 2_500);
        window.addEventListener('message', onMessage);
        window.postMessage({ type: 'RAYEN_FM_BRIDGE_PING', reqId }, window.location.origin);
      })
  );

export const readRelayHealth = statusPage =>
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

export const requestHhrHealth = (page, { verifySessions = false } = {}) =>
  page.evaluate(
    verifySessions =>
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
          { type: 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST', reqId, verifySessions },
          window.location.origin
        );
      }),
    verifySessions
  );

export const requestInvalidPatientFlow = page =>
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

export const requestClinicalBundle = (page, fecha, encId = '141121') =>
  page.evaluate(
    ({ encId, fecha }) =>
      new Promise((resolve, reject) => {
        const reqId = `clinical-bundle-e2e-${Date.now()}-${Math.random()}`;
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('HHR did not receive the clinical bundle after extension reload'));
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
            encId,
            fecha,
            acceptEntries: true,
            lookbackDays: 7,
          },
          window.location.origin
        );
      }),
    { encId, fecha }
  );

export const installSyntheticClinicalBackend = worker =>
  worker.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.__hhrSyntheticClinicalRequests = [];
    globalThis.__hhrSyntheticBackendMode = 'ok';
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://fichamedicoback.rayensalud.cl/')) {
        return originalFetch(input, init);
      }
      globalThis.__hhrSyntheticClinicalRequests.push(new URL(url).pathname);
      if (globalThis.__hhrSyntheticBackendMode === 'http-503') {
        return Promise.resolve(new Response('Service unavailable', { status: 503 }));
      }
      if (url.includes('/invasiveDeviceEntry/')) {
        return Promise.resolve(
          new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      if (
        url.includes('/getPatientEncounterHistoryReportServer/') ||
        url.includes('/encounterFormEntry/')
      ) {
        return Promise.resolve(
          new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      throw new Error(`Unexpected synthetic clinical endpoint: ${new URL(url).pathname}`);
    };
    return true;
  });

export const removeMainBridgeListener = async (context, page, source) => {
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

// Chrome's own extension testing guide closes the worker target to exercise a cold wake.
// Keep the three documents open so a passing health probe cannot hide a page reload.
export const terminateWorker = async (context, page, extensionId) => {
  const session = await context.newCDPSession(page);
  try {
    const { targetInfos } = await session.send('Target.getTargets');
    const target = targetInfos.find(
      info =>
        info.type === 'service_worker' &&
        info.url === `chrome-extension://${extensionId}/background.js`
    );
    assert.ok(target, 'MV3 worker target was missing before idle simulation');
    const result = await session.send('Target.closeTarget', { targetId: target.targetId });
    assert.equal(result.success, true, 'Chrome did not terminate the MV3 worker');
  } finally {
    await session.detach();
  }
};
