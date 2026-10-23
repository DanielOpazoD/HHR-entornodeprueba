import { expect, test } from '@playwright/test';
import { resolveCurrentClinicalDay } from '../src/utils/clinicalDayAdmissionUtils';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

test.describe('Rayen delayed extension health preflight', () => {
  test('keeps a disconnected preflight out of history and records an error only after verification', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const date = resolveCurrentClinicalDay();
    await page.addInitScript(() => {
      localStorage.setItem(
        'hhr_e2e_rayen_import_policy',
        JSON.stringify({ mode: 'preview', clinicalBatchMode: 'off', revision: 1 })
      );
      let connected = false;
      let initialPassiveGreen = true;
      let verifiedRequests = 0;
      let captureRequests = 0;
      const report = (syncPreflight: boolean) => ({
        version: 'e2e-preflight',
        protocolVersion: 5,
        capabilities: ['health-push', 'sync-preflight-verification'],
        syncPreflight,
        checkedAt: new Date().toISOString(),
        fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
        gestionCamas:
          connected || (!syncPreflight && initialPassiveGreen)
            ? { status: 'ready', message: 'Gestión de Camas disponible.' }
            : { status: 'stale', message: 'Gestión de Camas no está conectada.' },
      });
      window.addEventListener('message', event => {
        if (event.source !== window || event.origin !== location.origin) return;
        if (event.data?.type === 'E2E_RAYEN_RECONNECT') {
          connected = true;
          window.postMessage(
            { type: 'HHR_RAYEN_EXTENSION_HEALTH_PUSH', report: report(false) },
            location.origin
          );
          return;
        }
        if (event.data?.type === 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST') {
          const verifySessions = event.data.verifySessions === true;
          if (verifySessions) {
            document.documentElement.dataset.verifiedRequests = String(++verifiedRequests);
            initialPassiveGreen = false;
          }
          window.postMessage(
            {
              type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT',
              reqId: event.data.reqId,
              report: report(verifySessions),
            },
            location.origin
          );
          return;
        }
        if (event.data?.type === 'HHR_RAYEN_REQUEST_SYNC_BUNDLE') {
          document.documentElement.dataset.captureRequests = String(++captureRequests);
          window.postMessage(
            {
              type: 'HHR_RAYEN_IMPORT_ERROR',
              requestId: event.data.requestId,
              error: 'Fallo sintético de captura después de verificar ambas conexiones.',
            },
            location.origin
          );
        }
      });
    });
    await bootstrapSeededRecord(page, {
      role: 'admin',
      date,
      record: buildCanonicalE2ERecord(date),
      useRuntimeOverride: true,
      forceEditableRecord: true,
      forceLocalOnlySync: true,
      seedRemoteAuthority: true,
    });
    await page.goto(`/censo?date=${date}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
    const sync = page.getByTestId('rayen-import-button');
    const history = page.getByTestId('rayen-sync-history-button');
    await expect(sync).toBeEnabled({ timeout: 20_000 });
    await expect(history).toHaveAttribute('aria-label', /0 eventos/);
    await sync.click();
    await expect(sync).toBeDisabled();
    await expect(sync).toHaveAttribute('title', /Gestión de Camas no está conectada/);
    await expect(page.locator('html')).toHaveAttribute('data-verified-requests', '1');
    await expect(page.locator('html')).not.toHaveAttribute('data-capture-requests');
    await expect(history).toHaveAttribute('aria-label', /0 eventos/);

    await page.evaluate(() => window.postMessage({ type: 'E2E_RAYEN_RECONNECT' }, location.origin));
    await expect(sync).toBeEnabled();
    await sync.click();
    await expect(page.locator('html')).toHaveAttribute('data-verified-requests', '2');
    await expect(page.locator('html')).toHaveAttribute('data-capture-requests', '1');
    await expect(history).toHaveAttribute('aria-label', /1 eventos/, { timeout: 20_000 });
    await history.click();
    await expect(page.getByTestId('rayen-sync-history-modal')).toContainText('Fallida');
  });

  test('accepts a valid five-second greeting within the synchronization budget', async ({
    page,
  }) => {
    test.setTimeout(20_000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      window.addEventListener('message', event => {
        if (
          event.origin !== window.location.origin ||
          event.data?.type !== 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST'
        ) {
          return;
        }
        const reqId = event.data.reqId;
        window.setTimeout(() => {
          window.postMessage(
            {
              type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT',
              reqId,
              report: {
                version: 'e2e-delayed',
                protocolVersion: 5,
                capabilities: ['sync-preflight-verification'],
                syncPreflight: event.data.verifySessions === true,
                checkedAt: new Date().toISOString(),
                fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
                gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
              },
            },
            window.location.origin
          );
        }, 5_000);
      });
    });

    await page.addScriptTag({
      type: 'module',
      content: `
        import {
          requestRayenExtensionHealth,
          RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
        } from '/src/features/rayen-import/bridge/extensionHealthBridge.ts';
        import {
          deriveHealthState,
        } from '/src/features/rayen-import/hooks/useRayenExtensionHealth.ts';

        const startedAt = performance.now();
        window.__HHR_DELAYED_HEALTH_PREFLIGHT__ = requestRayenExtensionHealth(
          RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
          { verifySessions: true }
        ).then(result => ({
          elapsedMs: performance.now() - startedAt,
          state: deriveHealthState(result.report, result.error),
          syncPreflight: result.report?.syncPreflight,
        }));
      `,
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              '__HHR_DELAYED_HEALTH_PREFLIGHT__' in
              (window as Window & { __HHR_DELAYED_HEALTH_PREFLIGHT__?: unknown })
          ),
        { timeout: 5_000 }
      )
      .toBe(true);

    const result = await page.evaluate(async () => {
      const runtimeWindow = window as Window & {
        __HHR_DELAYED_HEALTH_PREFLIGHT__?: Promise<{
          elapsedMs: number;
          syncPreflight: boolean;
          state: { connection: string; canSync: boolean; message: string };
        }>;
      };
      return runtimeWindow.__HHR_DELAYED_HEALTH_PREFLIGHT__;
    });

    expect(result?.elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(result?.elapsedMs).toBeLessThan(12_000);
    expect(result?.syncPreflight).toBe(true);
    expect(result?.state).toMatchObject({
      connection: 'ready',
      canSync: true,
      message: 'Extensión Eloísa ve2e-delayed operativa.',
    });
  });
});
