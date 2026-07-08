import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getE2EDate = () => process.env.E2E_FIXED_DATE ?? new Date().toISOString().slice(0, 10);

const buildStatisticsRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'PACIENTE ESTADISTICA',
        rut: '11.111.111-1',
        pathology: 'Neumonía',
        specialty: 'Cardiología',
        status: 'Estable',
        age: '45',
        admissionDate: date,
      },
    },
    discharges: [
      {
        id: 'd-analytics-1',
        patientName: 'ALTA ESTADISTICA',
        rut: '22.222.222-2',
        diagnosis: 'Colelitiasis',
        specialty: 'Oftalmología',
        status: 'Vivo',
        time: '10:00',
        admissionDate: date,
      },
    ],
    cma: [
      {
        id: 'cma-analytics-1',
        patientName: 'PACIENTE CMA',
        rut: '33.333.333-3',
        diagnosis: 'Hernia',
        specialty: 'Dermatología',
        interventionType: 'Cirugía Mayor Ambulatoria',
        dischargeTime: '12:30',
        age: '50',
        bedName: 'CMA 1',
      },
    ],
  });
};

const openStatistics = async (page: Page) => {
  const date = getE2EDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildStatisticsRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto('/statistics');
  await ensureAuthenticated(page);
  await expect(page.getByText('Estadísticas MINSAL/DEIS')).toBeVisible({ timeout: 20000 });
};

const installReclassificationCapture = async (page: Page) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('hhr_e2e_capture_analytics_reclassifications', 'true');
    window.localStorage.setItem('hhr_e2e_analytics_reclassifications', '[]');
    window.localStorage.setItem('hhr_e2e_analytics_reclassification_calls', '[]');
  });
};

const readCapturedReclassificationCalls = async (page: Page) =>
  page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('hhr_e2e_analytics_reclassification_calls') || '[]')
  );

test.describe('Statistics authenticated module', () => {
  test('covers tabs, grouping, CMA drilldown, quality panel and export entrypoint', async ({
    page,
  }) => {
    await openStatistics(page);

    await expect(page.getByRole('button', { name: 'Exportar Excel' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();
    await expect(page.getByText('Comparación con período anterior')).toBeVisible();

    await page.getByRole('tab', { name: 'CMA/PMA' }).click();
    await expect(page.getByText('CMA / Hospitalización diurna')).toBeVisible();
    await page.getByRole('button', { name: 'Ver detalle total CMA/PMA' }).click();
    await expect(page.getByText('PACIENTE CMA')).toBeVisible();
    await expect(page.getByText('Hernia')).toBeVisible();
    await page.getByLabel('Cerrar modal').click();

    await page.getByRole('tab', { name: 'Especialidades' }).click();
    await page.getByRole('button', { name: 'Agrupar otras' }).click();
    await expect(page.getByText('Reclasificación estadística')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Solo filas con eventos' })).toBeVisible();

    await page.getByRole('tab', { name: 'Trazabilidad' }).click();
    await expect(page.getByText('Calidad de datos')).toBeVisible();
    await expect(page.getByText('Egreso sin fecha explícita')).toBeVisible();
  });

  test('saves and clears statistical specialty reclassification from the admin UI', async ({
    page,
  }) => {
    await installReclassificationCapture(page);
    await openStatistics(page);

    await page.getByRole('tab', { name: 'Especialidades' }).click();

    const reclassificationSelect = page.getByLabel('Reclasificar ALTA ESTADISTICA');
    await expect(reclassificationSelect).toBeVisible();

    await reclassificationSelect.selectOption('Cirugía');
    await expect(reclassificationSelect).toHaveValue('Cirugía');
    await expect
      .poll(() => readCapturedReclassificationCalls(page), { timeout: 10000 })
      .toContainEqual(
        expect.objectContaining({
          hospitalId: 'hanga_roa',
          date: getE2EDate(),
          movementKind: 'discharge',
          movementId: 'd-analytics-1',
          reportingSpecialty: 'Cirugía',
        })
      );

    await reclassificationSelect.selectOption('');
    await expect(reclassificationSelect).toHaveValue('');
    await expect
      .poll(() => readCapturedReclassificationCalls(page), { timeout: 10000 })
      .toContainEqual(
        expect.objectContaining({
          hospitalId: 'hanga_roa',
          date: getE2EDate(),
          movementKind: 'discharge',
          movementId: 'd-analytics-1',
          reportingSpecialty: null,
        })
      );
  });

  test('keeps the professional statistics navigation usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStatistics(page);

    await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();
    await page.getByRole('tab', { name: 'CMA/PMA' }).click();
    await expect(page.getByText('Eventos CMA/PMA')).toBeVisible();
    await page.getByRole('tab', { name: 'Trazabilidad' }).click();
    await expect(page.getByText('Calidad de datos')).toBeVisible();
  });
});
