import { test, expect, type Page } from '@playwright/test';
import { PatientDataSchema } from '../src/schemas/zod/patient';
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
        bedMode: 'Cama',
        patientName: PATIENT,
        rut: '12345678-5',
        clinicalEpisodeId: '123',
        pathology: 'DIAGNÓSTICO PREVIEW',
        age: '44',
        admissionDate: '2026-03-29',
        dischargeVerification: {
          medicalEpicrisis: 'confirmed',
          nursingEpicrisis: 'confirmed',
          encounterId: '123',
        },
      },
    },
  });

  // Invalid fixtures enter salvage normalization, replacing the episode while the panel opens.
  expect(
    PatientDataSchema.parse((record.beds as Record<string, unknown>).R1).clinicalEpisodeId
  ).toBe('123');

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
        const request = event.data as {
          type?: string;
          reqId?: string;
          operation?: string;
          entryId?: string;
          encId?: string;
          documentType?: string;
        };
        if (request.type === 'HHR_RAYEN_EPICRISIS_DOWNLOAD_REQUEST' && request.reqId) {
          const reportWindow = window as Window & { reportRequests?: unknown[] };
          (reportWindow.reportRequests ||= []).push(request);
          window.postMessage(
            {
              type: 'HHR_RAYEN_EPICRISIS_DOWNLOAD_RESULT',
              reqId: request.reqId,
              ok: true,
              ...(request.operation === 'list'
                ? {
                    episodes: [
                      { encId: '123', startDate: '2026-03-29', endDate: '' },
                      {
                        encId: '100',
                        startDate: '2025-01-01',
                        endDate: '2025-01-03',
                        active: false,
                      },
                    ],
                  }
                : {}),
            },
            window.location.origin
          );
          return;
        }
        if (request.type === 'HHR_RAYEN_CLINICAL_ACTION_REQUEST' && request.reqId) {
          const emergency = request.entryId === 'Primaria:9';
          window.postMessage(
            {
              type: 'HHR_RAYEN_CLINICAL_ACTION_RESULT',
              reqId: request.reqId,
              ok: true,
              ...(request.operation === 'list'
                ? {
                    entries: ['8', '9'].map(id => ({
                      id,
                      source: 'Primaria',
                      date: '20260929 10:30',
                      diagnosis: 'Diagnóstico sintético',
                      facility: 'Centro de prueba',
                      type: 'Consulta ambulatoria (APS)',
                    })),
                    warnings: [],
                    nextBeforeDate: null,
                  }
                : {
                    detail: {
                      reason: 'Motivo sintético',
                      history: 'Enfermedad sintética',
                      professional: 'Profesional de prueba',
                      patientName: 'PACIENTE LECTURA PREVIEW',
                      careType: emergency ? 'emergency' : 'outpatient',
                      diagnoses: ['Diagnóstico sintético', 'Segundo diagnóstico sintético'],
                      indications: ['Indicación sintética'],
                      attachments: [],
                      physicalExams: emergency
                        ? [
                            {
                              name: 'Examen Fisico Urgencia',
                              fields: [
                                { label: 'Observación', value: 'Examen sintético de urgencia' },
                              ],
                            },
                          ]
                        : [],
                      prescriptions: emergency
                        ? []
                        : [
                            {
                              id: '123',
                              date: '20260929 10:30',
                              status: 'Registrada',
                              type: 'General',
                              items: [
                                'Medicación sintética: 1 comprimido cada 24 horas por 30 días.',
                              ],
                            },
                          ],
                    },
                  }),
            },
            window.location.origin
          );
          return;
        }
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

test('downloads distinct epicrises from census badges and current/historical report actions', async ({
  page,
}) => {
  await seedClinicalPanel(page);
  await page.goto(`/?date=${DATE}`);
  const medical = page.getByRole('button', { name: /^Descargar epicrisis médica/ });
  const nursing = page.getByRole('button', { name: /^Descargar epicrisis de enfermería/ });
  await expect(medical).toBeVisible();
  for (const button of [medical, nursing]) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(24);
    expect(bounds?.height).toBeGreaterThanOrEqual(24);
    await button.press('Enter');
    await expect(button).toBeEnabled();
  }
  const downloads = () =>
    page.evaluate(() =>
      (
        (
          window as Window & {
            reportRequests?: { operation: string; encId: string; documentType: string }[];
          }
        ).reportRequests || []
      )
        .filter(request => request.operation === 'download')
        .map(({ encId, documentType }) => ({ encId, documentType }))
    );
  await expect.poll(downloads).toEqual([
    { encId: '123', documentType: 'epicrisis' },
    { encId: '123', documentType: 'nursing-epicrisis' },
  ]);
  await page.getByTestId('clinical-panel-trigger-R1').click();
  const drawer = page.getByTestId('clinical-panel-drawer-R1');
  await drawer
    .getByRole('button', { name: `Abrir informes de hospitalización de ${PATIENT}` })
    .click();
  const reports = page.getByTestId('patient-hospitalization-reports-dialog');
  await expect(reports.getByText('Episodio del censo')).toBeVisible();
  await reports.getByRole('button', { name: 'Epicrisis enfermería' }).first().click();
  await expect(reports.getByRole('button', { name: 'Epicrisis médica' }).last()).toBeEnabled();
  await reports.getByRole('button', { name: 'Epicrisis médica' }).last().click();
  await expect.poll(downloads).toEqual([
    { encId: '123', documentType: 'epicrisis' },
    { encId: '123', documentType: 'nursing-epicrisis' },
    { encId: '123', documentType: 'nursing-epicrisis' },
    { encId: '100', documentType: 'epicrisis' },
  ]);
  await page.screenshot({ path: test.info().outputPath('current-episode-reports.png') });
});

test.describe('failed clinical panel chunks', () => {
  // Fault injection must reach page routing instead of the PWA precache.
  test.use({ serviceWorkers: 'block' });

  for (const panel of ['drawer', 'reports'] as const) {
    test(`contains a failed ${panel} chunk without replacing the census`, async ({ page }) => {
      await seedClinicalPanel(page);
      const chunk =
        panel === 'drawer'
          ? /\/ClinicalPanelDrawer-[^/]+\.js(?:\?.*)?$/
          : /\/PatientHospitalizationReportsDialog-[^/]+\.js(?:\?.*)?$/;
      let blocked = 0;
      await page.route(chunk, route => {
        blocked += 1;
        return route.abort('failed');
      });
      await page.goto(`/?date=${DATE}`);
      const trigger = page.getByTestId('clinical-panel-trigger-R1');
      await trigger.click();
      if (panel === 'reports') {
        await page
          .getByTestId('clinical-panel-drawer-R1')
          .getByRole('button', { name: `Abrir informes de hospitalización de ${PATIENT}` })
          .click();
      }
      const fallback = page.getByTestId(
        panel === 'drawer' ? 'clinical-panel-module-loading' : 'reports-module-loading'
      );
      await expect(fallback.getByRole('alert')).toContainText('No se pudo abrir este panel');
      expect(blocked).toBeGreaterThan(0);
      await expect(trigger).toBeAttached();
      await fallback
        .getByRole('button', { name: panel === 'drawer' ? 'Cerrar panel clínico' : 'Cerrar modal' })
        .click();
      await expect(fallback).toBeHidden();
      if (panel === 'drawer') {
        await expect(trigger).toBeVisible();
        await expect(trigger).toBeFocused();
      } else {
        await expect(page.getByTestId('clinical-panel-drawer-R1')).toBeVisible();
      }
    });
  }
});

test('distingue APS y UEA y descarga una copia PDF accesible de la receta fuente', async ({
  page,
}) => {
  await seedClinicalPanel(page);
  await page.goto(`/?date=${DATE}`);
  await page.getByTestId('clinical-panel-trigger-R1').click();
  const drawer = page.getByTestId('clinical-panel-drawer-R1');
  await drawer.getByRole('button', { name: 'Antecedentes' }).click();
  const outpatient = drawer.locator('article').filter({ hasText: 'Atención ambulatoria (APS)' });
  const emergency = drawer.locator('article').filter({ hasText: 'Urgencia (UEA)' });
  await expect(outpatient).toContainText('Motivo sintético');
  await expect(outpatient).toContainText('Enfermedad sintética');
  await expect(outpatient).toContainText('Segundo diagnóstico sintético');
  await expect(outpatient).toContainText('Indicación sintética');
  await expect(emergency).toContainText('Examen sintético de urgencia');
  await expect(emergency.getByRole('heading', { name: 'Prescripciones' })).toHaveCount(0);
  const button = outpatient.getByRole('button', { name: 'Descargar copia PDF de receta 123' });
  await button.focus();
  const downloaded = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const pdf = await downloaded;
  expect(pdf.suggestedFilename()).toBe('receta-antecedente-123.pdf');
  await pdf.saveAs(test.info().outputPath('receta-sintetica.pdf'));
  await expect(button).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('antecedentes-aps-uea-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  const content = drawer.getByTestId('clinical-panel-content');
  expect(await content.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('antecedentes-aps-uea-mobile.png') });
});
