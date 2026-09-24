import { expect, test, type Page } from '@playwright/test';
import { resolveCurrentClinicalDay } from '../src/utils/clinicalDayAdmissionUtils';
import { getPreviousDay } from '../src/utils/clinicalDayScheduleUtils';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

/**
 * La creación desde Eloísa espera una comprobación remota del día.
 *
 * El botón sólo existe para el día clínico vigente, y el día clínico se resuelve en hora de
 * Rapa Nui aunque el dispositivo esté en hora continental (los runners fijan
 * `America/Santiago`). El spec usa el día clínico REAL calculado con la misma función que la
 * app (congelar `Date.now` deja a Firestore sin terminar la hidratación remota), con la
 * sincronización en modo local, donde nunca debe ofrecerse una creación mientras el estado
 * remoto sea incierto. La creación tras una comprobación positiva se cubre en la prueba de
 * integración censusEloisaBootstrap.integration.test.tsx.
 *
 * Lo que este spec garantiza:
 *  1. El día vigente sin lectura remota no ofrece un arranque inseguro.
 *  2. La disponibilidad de la extensión no elude esta comprobación.
 *  3. El censo previo existente sigue siendo accesible.
 */

const BOOTSTRAP_DAY = resolveCurrentClinicalDay();
const PREVIOUS_DAY = getPreviousDay(BOOTSTRAP_DAY);

const installFakeExtensionHealth = async (page: Page) => {
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_RAYEN_EXTENSION_HEALTH_REQUEST'
      ) {
        return;
      }
      window.postMessage(
        {
          type: 'HHR_RAYEN_EXTENSION_HEALTH_RESULT',
          reqId: event.data.reqId,
          report: {
            version: 'e2e-bootstrap',
            protocolVersion: 5,
            checkedAt: new Date().toISOString(),
            fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
            gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
          },
        },
        window.location.origin
      );
    });
  });
};

const openBootstrapDay = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: PREVIOUS_DAY,
    record: buildCanonicalE2ERecord(PREVIOUS_DAY),
    useRuntimeOverride: true,
    forceEditableRecord: true,
    forceLocalOnlySync: true,
  });
  await page.goto(`/censo?date=${BOOTSTRAP_DAY}`);
  await ensureAuthenticated(page);
  await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('empty-day-diagnostic-message')).toBeVisible({ timeout: 30_000 });
};

test.describe('Crear desde Eloísa · estado remoto incierto', () => {
  test('waits for a confirmed empty day and keeps the previous census available', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openBootstrapDay(page);
    await expect(page.getByTestId('create-from-rayen-btn')).toHaveCount(0);
    await expect(page.getByTestId('census-table')).toHaveCount(0);
    await expect(page.getByTestId('empty-day-diagnostic-message')).toContainText('Comprobando');

    await page.goto(`/censo?date=${PREVIOUS_DAY}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-from-rayen-btn')).toHaveCount(0);
  });

  test('does not let extension readiness bypass the remote census check', async ({ page }) => {
    test.setTimeout(90_000);
    await installFakeExtensionHealth(page);
    await openBootstrapDay(page);
    await expect(page.getByTestId('create-from-rayen-btn')).toHaveCount(0);
    await expect(page.getByTestId('census-table')).toHaveCount(0);
  });
});
