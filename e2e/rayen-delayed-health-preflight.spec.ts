import { expect, test } from '@playwright/test';

test.describe('Rayen delayed extension health preflight', () => {
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
          RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS
        ).then(result => ({
          elapsedMs: performance.now() - startedAt,
          state: deriveHealthState(result.report, result.error),
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
          state: { connection: string; canSync: boolean; message: string };
        }>;
      };
      return runtimeWindow.__HHR_DELAYED_HEALTH_PREFLIGHT__;
    });

    expect(result?.elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(result?.elapsedMs).toBeLessThan(12_000);
    expect(result?.state).toMatchObject({
      connection: 'ready',
      canSync: true,
      message: 'Extensión Eloísa ve2e-delayed operativa.',
    });
  });
});
