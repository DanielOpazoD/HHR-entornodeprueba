import { test, expect, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import {
  installPreviewFirebaseRuntime,
  type FirebasePreviewConfig,
} from './fixtures/previewFirebase';

const DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
const PATIENT = 'PACIENTE LECTURA PREVIEW';

const seedClinicalPanel = async (page: Page) => {
  const runtimeConfig = await installPreviewFirebaseRuntime(page);
  const baseRecord = buildCanonicalE2ERecord(DATE) as Record<string, unknown>;
  const beds = baseRecord.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(DATE, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: PATIENT,
        rut: '12345678-5',
        clinicalEpisodeId: 'preview-episode',
        pathology: 'DIAGNÓSTICO PREVIEW',
        age: '44',
        admissionDate: '2026-03-29',
      },
    },
  });

  await page.addInitScript(
    ({
      date,
      seededRecord,
      bootstrapUser,
      config,
    }: {
      date: string;
      seededRecord: unknown;
      bootstrapUser: unknown;
      config: FirebasePreviewConfig;
    }) => {
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = { [date]: seededRecord };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(config));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [date]: seededRecord }));

      window.addEventListener('message', event => {
        const request = event.data as { type?: string; reqId?: string };
        if (request.type !== 'HHR_RAYEN_CLINICAL_PANEL_REQUEST' || !request.reqId) return;
        window.postMessage(
          {
            type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT',
            reqId: request.reqId,
            documents: [],
            carePlan: { carePlanHeaders: [], medicationStates: [] },
            events: [
              {
                publishDatetime: '2026-04-03T12:00:00',
                evolutionResume: Array.from({ length: 12 }, (_, index) => ({
                  id: index + 1,
                  OBE_NOTES:
                    index === 0
                      ? 'Nota más reciente.\n\nSegundo párrafo de la evolución.'
                      : `Nota anterior ${index}. Observación clínica sintética para comprobar la lectura cronológica.`,
                  HCPR_NAME: 'Médico',
                  HCP_FGN: 'Ana',
                  HCP_FFN: 'Prueba',
                  OBE_PUBLISH_DATETIME: `2026-04-${String(3 - Math.floor(index / 6)).padStart(2, '0')}T${String(12 - (index % 6)).padStart(2, '0')}:00:00`,
                })),
                shiftChangeResume: [
                  {
                    ID: 99,
                    OBSERVATION: 'Entrega médica sintética.',
                    HCPR_NAME: 'Médico',
                    PUBLISH_DATETIME: '2026-04-03T11:30:00',
                  },
                ],
                patientPharmaIndicationResume: [],
                patientFreeIndicationResume: [],
                nutritionOrderResume: [],
                restResume: [],
              },
            ],
          },
          window.location.origin
        );
      });
    },
    { date: DATE, seededRecord: record, bootstrapUser: MOCK_USERS.admin, config: runtimeConfig }
  );
};

test('keeps the patient identity fixed above a calm chronological clinical list', async ({
  page,
}) => {
  await seedClinicalPanel(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.getByTestId('clinical-panel-trigger-R1')).toBeVisible();
  await page.getByTestId('clinical-panel-trigger-R1').click();

  const drawer = page.getByTestId('clinical-panel-drawer-R1');
  await expect(drawer.getByText('Nota más reciente.')).toBeVisible();
  await expect(
    drawer.getByRole('navigation', { name: 'Secciones clínicas' }).getByRole('button')
  ).toHaveCount(4);
  await expect(drawer.getByRole('group', { name: 'Filtrar evoluciones' })).toBeVisible();
  await expect(drawer.locator('article').first()).toContainText('Nota más reciente.');
  await expect(drawer.locator('article').first()).toHaveClass(/border-l-medical-600/);
  await expect(drawer.getByText('Segundo párrafo de la evolución.')).toBeVisible();

  const headerBefore = await drawer
    .locator('header')
    .first()
    .evaluate(element => element.getBoundingClientRect().top);
  await drawer.getByTestId('clinical-panel-content').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  const headerAfter = await drawer
    .locator('header')
    .first()
    .evaluate(element => element.getBoundingClientRect().top);
  expect(headerAfter).toBe(headerBefore);
  await drawer.getByTestId('clinical-panel-content').evaluate(element => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: test.info().outputPath('clinical-panel-desktop.png') });

  await drawer
    .getByRole('button', { name: `Abrir informes de hospitalización de ${PATIENT}` })
    .click();
  const reports = page.getByTestId('patient-hospitalization-reports-dialog');
  await expect(reports).toBeVisible();
  // A real click catches a modal rendered visually behind the side panel.
  await reports.getByRole('button', { name: 'Cerrar modal' }).click();
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Entregas (1)' }).click();
  await expect(drawer.getByText('Entrega médica sintética.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Notas (12)' }).click();
  await expect(drawer.getByText('Nota más reciente.')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileBounds = await drawer.boundingBox();
  const overlayBounds = await page.getByTestId('clinical-panel-overlay').boundingBox();
  expect(mobileBounds?.x).toBe(0);
  expect(mobileBounds?.width).toBe(overlayBounds?.width);
  await expect(drawer.getByRole('navigation', { name: 'Secciones clínicas' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('clinical-panel-mobile.png') });
});
