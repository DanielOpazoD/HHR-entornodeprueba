import { expect, test, type Page } from '@playwright/test';
import { resolveCurrentClinicalDay } from '../src/utils/clinicalDayAdmissionUtils';
import { getPreviousDay } from '../src/utils/clinicalDayScheduleUtils';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

/**
 * «Crear desde Eloísa» en un navegador real.
 *
 * El botón sólo existe para el día clínico vigente, y el día clínico se resuelve en hora de
 * Rapa Nui aunque el dispositivo esté en hora continental (los runners fijan
 * `America/Santiago`). El spec usa el día clínico REAL calculado con la misma función que la
 * app (congelar `Date.now` deja a Firestore sin terminar la hidratación remota), con la
 * sincronización en modo local (como el resto de los smoke que crean o editan días), sobre una
 * fecha que ningún otro spec persiste.
 *
 * Lo que este spec garantiza:
 *  1. El día vigente sin registro ofrece el arranque desde Eloísa.
 *  2. Sin extensión, el clic NO crea un día en blanco: el error queda a la vista y el prompt
 *     sigue ahí. Esta fue la queja original: un día vacío creado en silencio.
 *  3. Con la extensión disponible, el clic crea el día y entrega la intención a la barra de
 *     sincronización, que muestra un estado visible (nunca silencio) mientras la política
 *     global gobierna el arranque.
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
  const bootstrapButton = page.getByTestId('create-from-rayen-btn');
  await expect(bootstrapButton).toBeVisible({ timeout: 30_000 });
  // The button starts disabled while the extension health check runs.
  await expect(bootstrapButton).toBeEnabled({ timeout: 30_000 });
  return bootstrapButton;
};

test.describe('Crear desde Eloísa (día clínico vigente, navegador real)', () => {
  test('offers the Eloísa bootstrap only for the live clinical day', async ({ page }) => {
    test.setTimeout(90_000);
    const bootstrapButton = await openBootstrapDay(page);

    await expect(bootstrapButton).toContainText('Crear desde Eloísa');
    await expect(page.getByTestId('empty-day-diagnostic-message')).toBeVisible();

    // The previous day has a record, so it is never offered a bootstrap from Eloísa.
    await page.goto(`/censo?date=${PREVIOUS_DAY}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-from-rayen-btn')).toHaveCount(0);
  });

  test('never creates a blank day when the extension is unavailable', async ({ page }) => {
    test.setTimeout(90_000);
    const bootstrapButton = await openBootstrapDay(page);

    await bootstrapButton.click();

    // The failure is visible next to the button and the day was not created.
    await expect(bootstrapButton).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('create-from-rayen-btn')).toBeVisible();
    await expect(page.getByTestId('census-table')).toHaveCount(0);
    const status = page.locator('[role="status"]', { hasText: /Eloísa|extensión|Ficha|Camas/i });
    await expect(status.first()).toBeVisible();
  });

  test('creates the day and hands the intent to the sync toolbar when Eloísa is available', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await installFakeExtensionHealth(page);
    const bootstrapButton = await openBootstrapDay(page);

    await bootstrapButton.click();

    // Day created: the empty prompt is replaced by the census register.
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('create-from-rayen-btn')).toHaveCount(0);

    // The toolbar owns the intent and reports its state out loud. Whatever the global policy
    // says in this environment, the operator must see it: a sync in flight, a review, or the
    // policy notice. Silence is the failure mode this spec guards against.
    const toolbar = page.getByTestId('rayen-operations-bar');
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    await expect(toolbar).toContainText(/Eloísa/i, { timeout: 30_000 });
    const syncButton = page.getByTestId('rayen-import-button');
    await expect(syncButton).toBeVisible();
    // The button always explains itself: a policy notice, the extension state or the plain
    // action. An empty title would mean the operator was left guessing.
    await expect(syncButton).toHaveAttribute('title', /.+/);
    // Nothing was applied without a person: no confirmation happened on its own.
    await expect(page.getByText(/Todo al día/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Confirmar e importar/i })).toHaveCount(0);
  });
});
