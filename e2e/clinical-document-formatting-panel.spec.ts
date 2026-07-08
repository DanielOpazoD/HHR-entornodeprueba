import { expect, test, type Page } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

/**
 * Regression guard for the advanced-formatting panel and indentation controls.
 *
 * The panel was clipped off-screen by the modal header's scroll container
 * (`overflow-x:auto` coerces `overflow-y` to `auto`), so it never appeared and
 * the indent/outdent buttons inside it were unreachable. A jsdom unit test
 * cannot catch this (no layout), so this E2E asserts the panel renders inside
 * the viewport and the indent control is actually clickable.
 */

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';

const buildFormattingRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'FORMATO CLINICO',
        rut: '12.345.678-5',
        pathology: 'Control hospitalizado',
        specialty: 'Medicina',
        status: 'Estable',
        age: '45',
        admissionDate: date,
      },
    },
  });
};

const openAuthenticatedCensus = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildFormattingRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible({
    timeout: 10_000,
  });
};

const openClinicalDocumentsFromR1 = async (page: Page) => {
  const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  await expect(patientRow).toBeVisible({ timeout: 10_000 });

  await patientRow.getByRole('button', { name: /Datos del Paciente/i }).focus();
  await expect(page.getByLabel('Acciones clínicas rápidas')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Acciones clínicas rápidas').click();

  await expect(page.getByTitle('Documentos clínicos')).toBeVisible({ timeout: 10_000 });
  await page.getByTitle('Documentos clínicos').click();
  await expect(page.getByTestId('clinical-documents-workspace')).toBeVisible({ timeout: 15_000 });
};

test.describe('Clinical document formatting panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('formatting panel is reachable and indentation applies', async ({ page }) => {
    await openAuthenticatedCensus(page);
    await openClinicalDocumentsFromR1(page);

    await page.getByRole('button', { name: /Crear documento/i }).click();

    const editableSection = page.locator('[contenteditable="true"][data-section-editor]').first();
    await expect(editableSection).toBeVisible({ timeout: 15_000 });
    await editableSection.click();
    await editableSection.type('Linea para sangrar');

    // Open the advanced formatting panel.
    const formatButton = page.getByRole('button', { name: 'Formato' });
    await expect(formatButton).toBeEnabled({ timeout: 10_000 });
    await formatButton.click();

    const panel = page.locator('.clinical-document-global-toolbar-modal');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    // The whole panel must sit inside the viewport — the clipping bug pushed it
    // entirely outside the header's clip box.
    await expect(panel).toBeInViewport({ ratio: 0.9 });

    const panelBox = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(panelBox, 'panel must have a layout box').not.toBeNull();
    expect(viewport, 'viewport size must be defined').not.toBeNull();
    if (panelBox && viewport) {
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.y).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);
    }

    // The indent control lives inside the panel; clicking it exercises
    // Playwright's actionability/hit-testing — impossible if the panel were
    // clipped away. The command must apply a left indent to the active block.
    const indentButton = panel.getByRole('button', { name: 'Aumentar sangría' });
    await expect(indentButton).toBeVisible();
    await indentButton.click();

    await expect
      .poll(
        () =>
          editableSection.evaluate(node =>
            Array.from(node.querySelectorAll<HTMLElement>('*')).some(
              element => Number.parseInt(element.style.marginLeft || '0', 10) > 0
            )
          ),
        { timeout: 5_000 }
      )
      .toBe(true);
  });
});
