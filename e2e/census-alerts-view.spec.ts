import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import {
  installPreviewFirebaseRuntime,
  type FirebasePreviewConfig,
} from './fixtures/previewFirebase';

const DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
const ALERTS = [
  ['a-4', '03', '08:40', 'Pauta caídas (RM) adjunta en ficha, próxima evaluación 06/04/26'],
  ['a-3', '02', '21:15', 'Pauta Braden (BR) adjunta en ficha, próxima evaluación 05/04/26'],
  [
    'a-2',
    '01',
    '10:00',
    'Nota sintética de seguimiento con un texto largo que necesita dos líneas para leerse completo en la columna',
  ],
  ['a-1', '01', '07:30', 'Nota sintética más antigua'],
].map(([id, day, time, text]) => ({
  id,
  text,
  recordedAt: `2026-04-${day}T${time}`,
  author: 'Profesional Sintético',
}));

const seedCensus = async (page: Page) => {
  const config = await installPreviewFirebaseRuntime(page);
  const base = buildCanonicalE2ERecord(DATE);
  const beds = base.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(DATE, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'PACIENTE SINTÉTICA CON ALERTAS',
        rut: '12345678-5',
        clinicalEpisodeId: 'alerts-episode',
        age: '61',
        admissionDate: '2026-03-29',
        pathology: 'Diagnóstico sintético',
        clinicalAlerts: ALERTS,
      },
      R2: {
        ...beds.R2,
        patientName: 'PACIENTE SINTÉTICO SIN ALERTAS',
        rut: '12345678-5',
        clinicalEpisodeId: 'alerts-episode-r2',
        age: '48',
        admissionDate: '2026-03-30',
      },
    },
  });
  await page.addInitScript(
    ({
      date,
      seededRecord,
      bootstrapUser,
      runtimeConfig,
    }: {
      date: string;
      seededRecord: unknown;
      bootstrapUser: unknown;
      runtimeConfig: FirebasePreviewConfig;
    }) => {
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = { [date]: seededRecord };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [date]: seededRecord }));
    },
    { date: DATE, seededRecord: record, bootstrapUser: MOCK_USERS.admin, runtimeConfig: config }
  );
};

test('reads the three newest chart alerts in place of the clinical columns at 13-inch width', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await seedCensus(page);
  await page.goto(`/?date=${DATE}`);
  const row = page.locator('[data-testid="patient-row"][data-bed-id="R1"]');
  await expect(row).toContainText('PACIENTE SINTÉTICA CON ALERTAS', { timeout: 20_000 });

  await page.screenshot({ path: testInfo.outputPath('census-normal-header.png') });
  // The switch sits only next to Scores.
  await expect(page.getByTestId('census-alerts-view-toggle')).toHaveCount(1);
  await page.getByTestId('census-alerts-view-toggle').click();
  const view = row.getByTestId('clinical-alerts-view');
  await expect(view).toContainText('03-04');
  await expect(view).not.toContainText('08:40');
  await expect(view).toContainText(
    'Pauta caídas (RM) adjunta en ficha, próxima evaluación 06/04/26'
  );
  await expect(view).toContainText('+1 más');
  await expect(view).not.toContainText('Nota sintética más antigua');
  const scroll = page.locator('.census-table-scroll');
  const { clientWidth, scrollWidth } = await scroll.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  // The merged column lines up with its header.
  const header = page.getByRole('columnheader', { name: /Alertas de la ficha/ });
  const [headerBox, cellBox] = await Promise.all([
    header.boundingBox(),
    view.locator('..').boundingBox(),
  ]);
  expect(Math.abs(headerBox!.x - cellBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(headerBox!.width - cellBox!.width)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('census-alerts-view.png') });

  await view.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('listitem')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('census-alerts-detail.png') });
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('columnheader', { name: /Alertas de la ficha/ })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Columnas' }).click();
  await expect(page.getByRole('columnheader', { name: /Alertas de la ficha/ })).toHaveCount(0);
  await expect(page.getByTestId('census-alerts-view-toggle')).toHaveText('Alertas');
});
