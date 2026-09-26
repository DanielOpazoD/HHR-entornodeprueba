import { expect, test, type Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './fixtures/auth';
import {
  installPreviewFirebaseRuntime,
  type FirebasePreviewConfig,
} from './fixtures/previewFirebase';

const DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
const PATIENT = 'MARÍA ANTONIETA DEL CARMEN PAKOMIO RIVERO';

const seedCensus = async (page: Page) => {
  const config = await installPreviewFirebaseRuntime(page);
  const base = buildCanonicalE2ERecord(DATE);
  const beds = base.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(DATE, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: PATIENT,
        rut: '12345678-5',
        clinicalEpisodeId: 'visual-episode',
        age: '44',
        admissionDate: '2026-03-29',
        pathology:
          'Diagnóstico clínico sintético de descripción extensa para comprobar el ajuste de columnas',
        devices: ['VVP'],
        vitalSigns: {
          recordedDate: DATE,
          recordedAt: `${DATE} 12:00`,
          systolic: 130,
          diastolic: 82,
          heartRate: 84,
          spo2: 88,
          temperature: 36.5,
        },
      },
      R2: {
        ...beds.R2,
        patientName: 'PACIENTE SINTÉTICA DE NOMBRE LARGO',
        rut: '12345678-5',
        clinicalEpisodeId: 'visual-episode-r2',
        age: '52',
        admissionDate: '2026-03-29',
        specialty: 'Medicina Interna',
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

test('keeps long identity, vital grid, devices and open clinical panels legible at 13-inch 100% and 125%', async ({
  page,
}) => {
  await seedCensus(page);
  await page.goto(`/?date=${DATE}`);
  const row = page.locator('[data-testid="patient-row"][data-bed-id="R1"]');
  await expect(row).toContainText(PATIENT, { timeout: 20_000 });
  const movementSections = page.locator('.census-movement-section');
  await expect(movementSections).toHaveCount(3);

  for (const [zoom, width, height] of [
    ['100', 1280, 832],
    ['125', 1024, 666],
  ] as const) {
    await page.setViewportSize({ width, height });
    const name = row.getByText(PATIENT);
    const vitals = row.locator('.census-vitals-grid');
    const vitalCell = vitals.locator('xpath=ancestor::td');
    const deviceCell = row.locator('td').nth(6);
    const identityCell = row.locator('.census-identity-cell');
    const diagnosisCell = row.locator('.census-diagnosis-cell');

    await expect(name).toBeVisible();
    await expect(vitals).toContainText('PA');
    await expect(vitals).toContainText('FC');
    await expect(vitals).toContainText('SAT');
    await expect(vitals).toContainText('T°');
    await expect(deviceCell).toBeVisible();
    const vitalBounds = await vitalCell.boundingBox();
    const deviceBounds = await deviceCell.boundingBox();
    const nameBounds = await name.boundingBox();
    const identityBounds = await identityCell.boundingBox();
    const diagnosisBounds = await diagnosisCell.boundingBox();
    expect(vitalBounds).not.toBeNull();
    expect(deviceBounds).not.toBeNull();
    expect(nameBounds!.height).toBeLessThanOrEqual(33);
    expect(vitalBounds!.x + vitalBounds!.width).toBeLessThanOrEqual(deviceBounds!.x + 1);
    if (zoom === '100') {
      expect(diagnosisBounds!.width).toBeGreaterThanOrEqual(identityBounds!.width * 0.7);
    }
    const viewportBounds = await page.locator('.census-table-scroll').boundingBox();
    const shell = page.getByTestId('census-table-shell');
    const shellBounds = await shell.boundingBox();
    const shellBackground = await shell.evaluate(
      element => getComputedStyle(element).backgroundColor
    );
    expect(viewportBounds).not.toBeNull();
    expect(shellBounds).not.toBeNull();
    expect(viewportBounds!.x - shellBounds!.x).toBeGreaterThanOrEqual(56);
    expect(
      shellBounds!.x + shellBounds!.width - viewportBounds!.x - viewportBounds!.width
    ).toBeGreaterThanOrEqual(23);
    expect(shellBounds!.width - viewportBounds!.width).toBeGreaterThanOrEqual(79);
    expect(shellBackground).toBe('rgba(0, 0, 0, 0)');
    for (const section of await movementSections.all()) {
      const bounds = await section.boundingBox();
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.x - viewportBounds!.x)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(bounds!.x + bounds!.width - viewportBounds!.x - viewportBounds!.width)
      ).toBeLessThanOrEqual(1);
    }
    const scroll = page.locator('.census-table-scroll');
    const { clientWidth, scrollWidth } = await scroll.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    if (zoom === '125') {
      const statusHeader = page.getByRole('columnheader', { name: 'Estado clínico' });
      await expect(statusHeader).toBeEmpty();
    }
    const secondRow = page.locator('[data-testid="patient-row"][data-bed-id="R2"]');
    const secondIdentity = secondRow.locator('.census-identity-cell');
    const action = secondRow.getByTestId('clinical-panel-trigger-R2');
    await expect(secondIdentity).toContainText('PACIENTE SINTÉTICA DE NOMBRE LARGO');
    const detailsBox = await secondIdentity.locator('.census-identity-details').boundingBox();
    const actionBox = await action.boundingBox();
    expect(actionBox!.y).toBeLessThan(detailsBox!.y + 8);
    await action.focus();
    const rowColor = await secondRow.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(rowColor).not.toBe('rgb(240, 253, 250)');
    await action.evaluate(element => element.blur());
    await page.mouse.move(1, 1);
    await page.screenshot({
      path: process.env.CENSUS_VISUAL_OUTPUT_DIR
        ? `${process.env.CENSUS_VISUAL_OUTPUT_DIR}/census-air-${zoom}.png`
        : test.info().outputPath(`census-air-${zoom}.png`),
      animations: 'disabled',
    });

    await deviceCell.locator('div.cursor-pointer').first().click();
    const deviceMenu = page.getByText('Vías Venosas (VVP)');
    await expect(deviceMenu).toBeVisible();
    const menuBounds = await deviceMenu
      .locator('xpath=ancestor::div[contains(@class,"fixed")]')
      .boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width + 1);
    await page.mouse.click(10, 300);

    await page.getByTestId('clinical-panel-trigger-R1').click();
    const drawer = page.getByTestId('clinical-panel-drawer-R1');
    await expect(drawer).toBeVisible();
    const drawerBounds = await drawer.boundingBox();
    expect(drawerBounds!.x + drawerBounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: test.info().outputPath(`clinical-air-${zoom}.png`),
      animations: 'disabled',
    });
    await drawer
      .getByRole('button', { name: `Abrir informes de hospitalización de ${PATIENT}` })
      .click();
    const reports = page.getByTestId('patient-hospitalization-reports-dialog');
    await expect(reports).toBeVisible();
    const reportsBounds = await reports.boundingBox();
    expect(reportsBounds!.x).toBeGreaterThanOrEqual(0);
    expect(reportsBounds!.x + reportsBounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: test.info().outputPath(`reports-air-${zoom}.png`),
      animations: 'disabled',
    });
    await reports.getByRole('button', { name: 'Cerrar modal' }).click();
    await drawer.getByRole('button', { name: 'Cerrar panel clínico' }).click();
  }

  await page.setViewportSize({ width: 1280, height: 832 });
  await movementSections.first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: process.env.CENSUS_VISUAL_OUTPUT_DIR
      ? `${process.env.CENSUS_VISUAL_OUTPUT_DIR}/census-movement-alignment.png`
      : test.info().outputPath('census-movement-alignment.png'),
    animations: 'disabled',
  });
});
