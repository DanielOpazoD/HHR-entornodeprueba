import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const E2E_DATE = process.env.E2E_FIXED_DATE ?? '2026-02-20';
const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CapturedDownload {
  blobSize: number;
  blobType: string;
  filename: string;
}

const buildVisualReleaseRecord = (date: string) => {
  const canonical = buildCanonicalE2ERecord(date);
  const beds = canonical.beds as Record<string, Record<string, unknown>>;

  return buildCanonicalE2ERecord(date, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: 'VALIDACION VISUAL BLOQUE 4',
        rut: '12.345.678-5',
        pathology: 'Neumonia adquirida en la comunidad',
        specialty: 'Medicina',
        status: 'Estable',
        age: '45',
        admissionDate: date,
      },
      R2: {
        ...beds.R2,
        patientName: 'PACIENTE CONTROL VISUAL',
        rut: '11.111.111-1',
        pathology: 'Control postoperatorio',
        specialty: 'Cirugia',
        status: 'Observacion',
        age: '61',
        admissionDate: date,
      },
    },
  });
};

const disableMotion = async (page: Page) => {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important;}',
  });
};

const attachViewportEvidence = async (page: Page, testInfo: TestInfo, name: string) => {
  await disableMotion(page);
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
};

const verifyMobileViewportEvidence = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  overflowScopes = ['html']
) => {
  await page.setViewportSize({ width: 390, height: 780 });
  for (const scope of overflowScopes) {
    await expectNoHorizontalOverflow(page, scope);
  }
  await attachViewportEvidence(page, testInfo, name);
  await page.setViewportSize({ width: 1440, height: 900 });
};

const expectNoHorizontalOverflow = async (page: Page, selector = 'html') => {
  const layout = await page
    .locator(selector)
    .first()
    .evaluate(element => {
      const isDocumentRoot = element === document.documentElement;
      const scopeRect = element.getBoundingClientRect();
      const leftBoundary = isDocumentRoot ? 0 : scopeRect.left;
      const rightBoundary = isDocumentRoot ? document.documentElement.clientWidth : scopeRect.right;
      const clientWidth = isDocumentRoot
        ? document.documentElement.clientWidth
        : Math.round(scopeRect.width);
      const isContainedByHorizontalScroller = (node: HTMLElement) => {
        let current: HTMLElement | null = node;
        while (current && current !== element) {
          const overflowX = window.getComputedStyle(current).overflowX;
          if (['auto', 'clip', 'hidden', 'scroll'].includes(overflowX)) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      };
      const offenders = Array.from(element.querySelectorAll<HTMLElement>('*'))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            className: String(element.className || ''),
            element,
            tagName: element.tagName.toLowerCase(),
            text: String(element.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 80),
            width: Math.round(rect.width),
            x: Math.round(rect.x),
            right: Math.round(rect.right),
          };
        })
        .filter(
          item =>
            item.right > rightBoundary + 2 ||
            item.x < leftBoundary - 2 ||
            item.width > clientWidth + 2
        )
        .filter(item => !isContainedByHorizontalScroller(item.element))
        .sort((left, right) => right.width - left.width)
        .slice(0, 5)
        .map(({ element: _element, ...item }) => item);

      return {
        clientWidth,
        offenders,
      };
    });

  expect(
    layout.offenders,
    `release visual viewport must not introduce page overflow: ${JSON.stringify(layout.offenders)}`
  ).toEqual([]);
};

const expectClinicalDocumentsAttachmentsContainment = async (page: Page) => {
  const attachmentsPanel = page.locator('.clinical-document-attachments-panel').first();
  await expect(attachmentsPanel).toBeVisible({ timeout: 15_000 });

  const panelBounds = await attachmentsPanel.boundingBox();
  const viewportSize = page.viewportSize();

  expect(panelBounds, 'clinical episode attachment panel must render').not.toBeNull();
  expect(viewportSize, 'visual smoke viewport must be defined').not.toBeNull();
  if (!panelBounds || !viewportSize) return;

  expect(
    panelBounds.width,
    'clinical episode attachment panel width must stay narrower than the viewport'
  ).toBeLessThanOrEqual(viewportSize.width - 48);
  expect(
    panelBounds.x,
    'clinical episode attachment panel must keep a left margin'
  ).toBeGreaterThan(24);
  expect(
    viewportSize.width - (panelBounds.x + panelBounds.width),
    'clinical episode attachment panel must keep a right margin'
  ).toBeGreaterThan(24);
};

const clearCapturedDownload = async (page: Page) => {
  await page.evaluate(() => {
    const captureWindow = window as Window & {
      __HHR_DOWNLOAD_CAPTURE__?: CapturedDownload | null;
    };
    captureWindow.__HHR_DOWNLOAD_CAPTURE__ = null;
    window.localStorage.removeItem('hhr_e2e_last_download');
  });
};

const readCapturedDownload = async (page: Page): Promise<CapturedDownload | null> =>
  page.evaluate(() => {
    const captureWindow = window as Window & {
      __HHR_DOWNLOAD_CAPTURE__?: CapturedDownload | null;
    };
    return (
      captureWindow.__HHR_DOWNLOAD_CAPTURE__ ??
      (JSON.parse(
        window.localStorage.getItem('hhr_e2e_last_download') || 'null'
      ) as CapturedDownload | null)
    );
  });

const expectCapturedExcelDownload = async (
  page: Page,
  testInfo: TestInfo,
  evidenceName: string,
  filenamePattern: RegExp
) => {
  await expect.poll(() => readCapturedDownload(page), { timeout: 20_000 }).toBeTruthy();
  const downloadMeta = await readCapturedDownload(page);

  expect(downloadMeta?.filename).toMatch(filenamePattern);
  expect(downloadMeta?.filename).toMatch(/\.xlsx$/i);
  expect(downloadMeta?.blobType).toContain(EXCEL_MIME_TYPE);
  expect(downloadMeta?.blobSize ?? 0).toBeGreaterThan(5_000);

  await testInfo.attach(`${evidenceName}.json`, {
    body: JSON.stringify(downloadMeta, null, 2),
    contentType: 'application/json',
  });
};

const openVisualCensus = async (page: Page) => {
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date: E2E_DATE,
    record: buildVisualReleaseRecord(E2E_DATE),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });

  await page.goto(`/censo?date=${E2E_DATE}`);
  await ensureAuthenticated(page);
  await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible({
    timeout: 10_000,
  });
};

const verifyRefreshLoginResilience = async (page: Page) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  await expect(page.getByTestId('authenticated-user-menu-button')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]')).toBeVisible({
    timeout: 10_000,
  });
};

const verifyCensusExcelDownload = async (page: Page, testInfo: TestInfo) => {
  await clearCapturedDownload(page);

  const saveButton = page.getByRole('button', { name: /Guardar|Guardado|Archivado/i }).first();
  await expect(saveButton).toBeVisible({ timeout: 10_000 });
  await saveButton.evaluate((element: HTMLElement) => element.click());
  await page.getByRole('button', { name: /Descargar Excel/i }).click();

  await expectCapturedExcelDownload(
    page,
    testInfo,
    'clinical-release-census-excel-download',
    [/censo/i, /\d{2}-\d{2}-\d{4}/].reduce(
      (pattern, next) => new RegExp(`${pattern.source}|${next.source}`, 'i')
    )
  );
};

const verifyUtilityMenuVisualSmoke = async (page: Page, testInfo: TestInfo) => {
  const utilityMenuButton = page.getByTestId('navbar-utility-menu-button');
  await expect(utilityMenuButton).toBeVisible({ timeout: 10_000 });
  await utilityMenuButton.click();

  const utilityMenu = page.getByTestId('navbar-utility-menu');
  await expect(utilityMenu).toBeVisible({ timeout: 10_000 });
  await expect(utilityMenu.getByText('Estadísticas')).toBeVisible();
  await expect(utilityMenu.getByText('Archivos')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportEvidence(page, testInfo, 'clinical-release-utility-menu');
};

const verifyAuditVisualSmoke = async (page: Page, testInfo: TestInfo) => {
  await page.goto('/audit', { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page);
  await expect(page).toHaveURL(/\/audit/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /registro de auditoría/i })).toBeVisible({
    timeout: 20_000,
  });
  await expectNoHorizontalOverflow(page);
  await attachViewportEvidence(page, testInfo, 'clinical-release-audit');
  await verifyMobileViewportEvidence(page, testInfo, 'clinical-release-audit-mobile');
};

const verifyPrescriptionUploadMobileVisualSmoke = async (page: Page, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/recetas/upload', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /respaldo de receta/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('textbox', { name: /pin de acceso/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: /continuar/i })).toBeVisible({
    timeout: 10_000,
  });
  await expectNoHorizontalOverflow(page);
  await attachViewportEvidence(page, testInfo, 'clinical-release-prescription-upload-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
};

const openClinicalDocumentsFromR1 = async (page: Page) => {
  const patientRow = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  await expect(patientRow).toBeVisible({ timeout: 10_000 });

  await patientRow.getByRole('button', { name: /Datos del Paciente/i }).focus();
  const quickActionsLauncher = page
    .getByRole('button', {
      name: 'Acciones clínicas rápidas',
    })
    .first();
  await expect(quickActionsLauncher).toBeVisible({ timeout: 10_000 });
  await quickActionsLauncher.click();

  await expect(page.getByTitle('Documentos clínicos')).toBeVisible({ timeout: 10_000 });
  await page.getByTitle('Documentos clínicos').click();
  await expect(page.getByTestId('clinical-documents-workspace')).toBeVisible({ timeout: 15_000 });
};

const createClinicalDocumentEvidence = async (page: Page) => {
  await page.getByRole('button', { name: /Crear documento/i }).click();

  const editableSection = page.locator('[contenteditable="true"][data-section-editor]').first();
  await expect(editableSection).toBeVisible({ timeout: 15_000 });
  await editableSection.fill('Documento clínico creado desde smoke visual de release.');
  await expect(editableSection).toContainText('smoke visual de release');
};

const createMedicalHandoffEvidence = async (page: Page) => {
  const createMedicalHandoffButton = page
    .getByTestId('medical-handoff-create-entry-button')
    .first();
  await expect(createMedicalHandoffButton).toBeVisible({
    timeout: 20_000,
  });
  await createMedicalHandoffButton.click();

  const handoffTextarea = page.locator('textarea').first();
  await expect(handoffTextarea).toBeVisible({ timeout: 10_000 });
  await handoffTextarea.fill('Entrega médica creada desde smoke visual de release.');
  await expect(handoffTextarea).toHaveValue(/smoke visual de release/i);
};

const createCudyrEvidence = async (page: Page) => {
  await page.goto(`/cudyr?date=${E2E_DATE}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/cudyr/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /instrumento cudyr/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: /excel mensual/i })).toBeVisible({
    timeout: 10_000,
  });
};

const verifyCudyrExcelDownload = async (page: Page, testInfo: TestInfo) => {
  await clearCapturedDownload(page);
  await page.getByRole('button', { name: /excel mensual/i }).click();

  await expectCapturedExcelDownload(
    page,
    testInfo,
    'clinical-release-cudyr-excel-download',
    /CUDYR_Mensual|cudyr/i
  );
};

test.describe('Clinical release visual smoke', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('creates release-critical clinical surfaces without layout overflow', async ({
    page,
  }, testInfo) => {
    await openVisualCensus(page);
    await expectNoHorizontalOverflow(page);
    await attachViewportEvidence(page, testInfo, 'clinical-release-census');
    await verifyRefreshLoginResilience(page);
    await expectNoHorizontalOverflow(page);
    await attachViewportEvidence(page, testInfo, 'clinical-release-census-after-refresh');
    await verifyCensusExcelDownload(page, testInfo);
    await verifyUtilityMenuVisualSmoke(page, testInfo);
    await verifyAuditVisualSmoke(page, testInfo);
    await verifyPrescriptionUploadMobileVisualSmoke(page, testInfo);
    await openVisualCensus(page);

    await openClinicalDocumentsFromR1(page);
    await createClinicalDocumentEvidence(page);
    await expectNoHorizontalOverflow(page, '[role="dialog"]');
    await expectClinicalDocumentsAttachmentsContainment(page);
    await attachViewportEvidence(page, testInfo, 'clinical-release-documents');
    await verifyMobileViewportEvidence(page, testInfo, 'clinical-release-documents-mobile', [
      '[role="dialog"]',
    ]);
    await expectClinicalDocumentsAttachmentsContainment(page);

    await createCudyrEvidence(page);
    await expectNoHorizontalOverflow(page);
    await attachViewportEvidence(page, testInfo, 'clinical-release-cudyr');
    await verifyMobileViewportEvidence(page, testInfo, 'clinical-release-cudyr-mobile');
    await verifyCudyrExcelDownload(page, testInfo);

    await page.goto(`/medical-handoff?date=${E2E_DATE}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/medical-handoff/, { timeout: 20_000 });
    await createMedicalHandoffEvidence(page);
    await expectNoHorizontalOverflow(page);
    await attachViewportEvidence(page, testInfo, 'clinical-release-medical-handoff');
  });
});
