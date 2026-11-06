import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { panelResult } from '../src/tests/views/census/clinicalPanelDrawer.fixture';
import {
  seedVisualCensus,
  VISUAL_DATE as DATE,
  VISUAL_PATIENT as PATIENT,
  VISUAL_SECOND_PATIENT as SECOND_PATIENT,
} from './fixtures/censusVisualSeed';

const openExplorerFromBed = async (page: Page, bedId: string): Promise<void> => {
  await page.getByTestId(`clinical-panel-trigger-${bedId}`).click();
  const drawer = page.getByTestId(`clinical-panel-drawer-${bedId}`);
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await drawer.getByRole('button', { name: /Abrir explorador clínico de/ }).click();
  await expect(page.getByTestId('clinical-explorer')).toBeVisible({ timeout: 20_000 });
};

const screenshot = (page: Page, name: string) =>
  page.screenshot({
    path: process.env.CENSUS_VISUAL_OUTPUT_DIR
      ? `${process.env.CENSUS_VISUAL_OUTPUT_DIR}/${name}.png`
      : test.info().outputPath(`${name}.png`),
    animations: 'disabled',
    fullPage: true,
    mask: [page.getByRole('button', { name: /^Usuario / }).locator('..')],
  });

test('keeps the clinical explorer legible at 13-inch 100% and 125% and returns to the census', async ({
  page,
}) => {
  await seedVisualCensus(page);
  await page.addInitScript(panel => {
    window.addEventListener('message', event => {
      const request = event.data;
      if (request?.type !== 'HHR_RAYEN_CLINICAL_PANEL_REQUEST' || !request.reqId) return;
      window.postMessage(
        { ...panel, type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT', reqId: request.reqId },
        window.location.origin
      );
    });
  }, panelResult);
  await page.goto(`/?date=${DATE}`);
  const row = page.locator('[data-testid="patient-row"][data-bed-id="R1"]');
  await expect(row).toContainText(PATIENT, { timeout: 20_000 });

  await openExplorerFromBed(page, 'R1');
  const explorer = page.getByTestId('clinical-explorer');
  const header = page.getByTestId('clinical-explorer-patient');
  await expect(header).toContainText(PATIENT);
  // The census stays mounted but out of sight: coming back is instant and loses nothing.
  await expect(page.locator('.census-register')).toBeHidden();

  for (const [zoom, width, height] of [
    ['100', 1280, 832],
    ['125', 1024, 666],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(header).toContainText(PATIENT);

    // Nothing pushes the page sideways.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Patient list beside the panel, both inside the viewport.
    const list = page.getByRole('complementary', { name: 'Pacientes del censo' });
    const listBounds = await list.boundingBox();
    const headerBounds = await header.boundingBox();
    const explorerBounds = await explorer.boundingBox();
    expect(listBounds).not.toBeNull();
    expect(headerBounds).not.toBeNull();
    expect(explorerBounds).not.toBeNull();
    expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(headerBounds!.x + 1);
    expect(headerBounds!.width).toBeGreaterThanOrEqual(explorerBounds!.width * 0.6);
    expect(explorerBounds!.x + explorerBounds!.width).toBeLessThanOrEqual(width + 1);
    // The patient header is two short lines; at 1280 the requests fit beside them.
    if (width === 1280) expect(headerBounds!.height).toBeLessThanOrEqual(64);

    // The five areas are announced by name; the tab strip keeps one row.
    const tabs = page.getByRole('tablist', { name: 'Áreas' });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    const tabBounds = await tabs.boundingBox();
    expect(tabBounds!.height).toBeLessThanOrEqual(40);
    for (const area of [
      'Evoluciones',
      'Signos vitales',
      'Laboratorio',
      'Imágenes',
      'Indicaciones',
    ]) {
      await expect(page.getByRole('region', { name: area })).toBeVisible();
    }

    const evolutionsBounds = await page.getByRole('region', { name: 'Evoluciones' }).boundingBox();
    const vitals = page.getByRole('region', { name: 'Signos vitales' });
    await expect(vitals).toContainText('130/82');
    const vitalsBounds = await vitals.boundingBox();
    if (width === 1280) {
      expect(vitalsBounds!.y).toBe(evolutionsBounds!.y);
      expect(vitalsBounds!.x).toBeGreaterThan(evolutionsBounds!.x);
    } else {
      expect(vitalsBounds!.y).toBeGreaterThan(evolutionsBounds!.y);
    }
    await expect(
      page
        .getByRole('region', { name: 'Explorador clínico', exact: true })
        .getByText('Experimental', { exact: true })
    ).toHaveCount(0);

    // Syslab and MMRAD are out of reach here: a source that cannot be read is never shown as an
    // empty hospitalization (SAVE-01).
    await expect(page.getByRole('region', { name: 'Laboratorio' })).not.toContainText(
      'Sin informes de laboratorio'
    );
    await expect(page.getByRole('region', { name: 'Imágenes' })).not.toContainText(
      'Sin estudios de imágenes'
    );

    await page.mouse.move(1, 1);
    await screenshot(page, `clinical-explorer-${zoom}`);
  }

  // Another patient from the side list, and back with the keyboard.
  await page
    .getByRole('list', { name: 'Lista de pacientes' })
    .getByRole('button', { name: new RegExp(SECOND_PATIENT) })
    .click();
  await expect(header).toContainText(SECOND_PATIENT);
  await page.keyboard.press('ArrowLeft');
  await expect(header).toContainText(PATIENT);

  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'clinical-explorer-mobile');
  await expect(header).toContainText(PATIENT);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const indicationsTab = page.getByRole('tab', { name: 'Indicaciones', exact: true });
  await indicationsTab.scrollIntoViewIfNeeded();
  await indicationsTab.click();
  await expect(indicationsTab).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 1024, height: 666 });

  // Back to the census: same day, same row, focus on the trigger that opened the explorer.
  await page.getByRole('button', { name: 'Volver al censo' }).click();
  await expect(page.getByTestId('clinical-explorer')).toHaveCount(0);
  await expect(page.locator('.census-register')).toBeVisible();
  await expect(row).toContainText(PATIENT);
  await expect(page.getByTestId('clinical-panel-trigger-R1')).toBeFocused();
});

test('prints the laboratory orders of several patients as one document, one page each', async ({
  page,
}) => {
  await seedVisualCensus(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toContainText(
    PATIENT,
    { timeout: 20_000 }
  );
  await openExplorerFromBed(page, 'R1');

  await page.getByRole('button', { name: 'Exámenes', exact: true }).click();
  const dialog = page.getByTestId('exam-request-modal');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /Pacientes/ }).click();
  await dialog.getByRole('checkbox', { name: /R2/ }).check();
  const tabs = dialog.getByRole('tablist', { name: 'Pacientes de la solicitud' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', { selected: true })).toContainText(SECOND_PATIENT);

  // On screen only the active order shows; the printed document carries both.
  const forms = dialog.getByTestId('exam-request-form');
  await expect(forms).toHaveCount(2);
  await expect(forms.nth(0)).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(forms.nth(0)).toBeVisible();
  await expect(forms.nth(1)).toBeVisible();

  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? [];
  expect(pages).toHaveLength(2);
  if (process.env.CENSUS_VISUAL_OUTPUT_DIR) {
    writeFileSync(`${process.env.CENSUS_VISUAL_OUTPUT_DIR}/exam-orders-two-patients.pdf`, pdf);
  }
});
