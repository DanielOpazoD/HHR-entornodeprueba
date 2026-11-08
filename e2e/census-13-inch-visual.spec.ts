import { expect, test } from '@playwright/test';
import {
  seedVisualCensus as seedCensus,
  VISUAL_DATE as DATE,
  VISUAL_PATIENT as PATIENT,
} from './fixtures/censusVisualSeed';
import { openPatientClinicalTopic } from './fixtures/patientClinicalTopics';

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
    const deviceCell = row.locator('td').nth(7);
    const identityCell = row.locator('.census-identity-cell');
    const diagnosisCell = row.locator('.census-diagnosis-cell');
    const diagnosisText = diagnosisCell.getByText(/Diagnóstico clínico sintético/);

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
    // The clinical topics live in their own «Accesos» column: the name keeps the whole cell.
    await expect(identityCell.locator('.census-identity-actions')).toHaveCount(0);
    const accessCell = row.locator('.census-access-cell');
    const accessButton = accessCell.getByTestId('clinical-access-R1');
    await expect(accessButton).toBeVisible();
    const accessBounds = await accessCell.boundingBox();
    expect(accessBounds!.width).toBeGreaterThanOrEqual(56);
    // One access button, centred in its column.
    const buttonBounds = await accessButton.boundingBox();
    expect(
      Math.abs(
        buttonBounds!.x + buttonBounds!.width / 2 - (accessBounds!.x + accessBounds!.width / 2)
      )
    ).toBeLessThanOrEqual(1);
    // Its ring holds the four topics around the explorer and fits on screen at both zooms.
    await accessButton.click();
    const ring = page.getByTestId('clinical-access-menu');
    await expect(ring).toBeVisible();
    for (const topic of ['ficha', 'laboratory', 'imaging', 'documents', 'explorer']) {
      await expect(page.getByTestId(`clinical-access-${topic}-R1`)).toBeVisible();
    }
    const ringBounds = await ring.boundingBox();
    expect(ringBounds!.x).toBeGreaterThanOrEqual(0);
    expect(ringBounds!.y).toBeGreaterThanOrEqual(0);
    expect(ringBounds!.x + ringBounds!.width).toBeLessThanOrEqual(width);
    expect(ringBounds!.y + ringBounds!.height).toBeLessThanOrEqual(height);
    await test.info().attach(`accesos-ring-${zoom}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(ring).toHaveCount(0);
    await expect(accessButton).toBeFocused();
    expect(accessBounds!.x).toBeGreaterThanOrEqual(identityBounds!.x + identityBounds!.width - 1);
    expect(await diagnosisText.evaluate(element => getComputedStyle(element).webkitLineClamp)).toBe(
      '2'
    );
    await expect(deviceCell.getByText('SNG')).toBeVisible();
    await expect(deviceCell.getByTitle(/Sonda nasogástrica/)).toBeVisible();
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
    // Filled and empty readings must share the same inset value axes.
    const valueAxes = async (grid: typeof vitals) =>
      grid.evaluate(element =>
        Array.from(element.children).map(pair => {
          const value = pair.lastElementChild!;
          const range = document.createRange();
          range.selectNodeContents(value);
          const text = range.getBoundingClientRect();
          const slot = value.getBoundingClientRect();
          return { center: slot.x + slot.width / 2, textCenter: text.x + text.width / 2 };
        })
      );
    const filledAxes = await valueAxes(vitals);
    const emptyAxes = await valueAxes(secondRow.locator('.census-vitals-grid'));
    for (let index = 0; index < filledAxes.length; index += 1) {
      expect(Math.abs(filledAxes[index].center - emptyAxes[index].center)).toBeLessThanOrEqual(1);
      expect(Math.abs(filledAxes[index].center - filledAxes[index].textCenter)).toBeLessThanOrEqual(
        1
      );
      expect(Math.abs(emptyAxes[index].center - emptyAxes[index].textCenter)).toBeLessThanOrEqual(
        1
      );
    }
    const secondIdentity = secondRow.locator('.census-identity-cell');
    await expect(secondIdentity).toContainText('PACIENTE SINTÉTICA DE NOMBRE LARGO');
    await page.mouse.move(1, 1);
    await page.screenshot({
      path: process.env.CENSUS_VISUAL_OUTPUT_DIR
        ? `${process.env.CENSUS_VISUAL_OUTPUT_DIR}/census-air-${zoom}.png`
        : test.info().outputPath(`census-air-${zoom}.png`),
      animations: 'disabled',
    });

    await diagnosisCell.getByRole('button', { name: 'Editar diagnóstico' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('clinical-block-editor-R1')).toBeVisible();
    await expect(page.getByTestId('clinical-block-pathology-R1')).toHaveValue(
      'Diagnóstico clínico sintético de descripción extensa para comprobar el ajuste de columnas'
    );
    await page.keyboard.press('Escape');

    await deviceCell
      .getByRole('button', { name: /Editar dispositivos|Agregar dispositivo/ })
      .click();
    const deviceMenu = page.getByText('Vías Venosas (VVP)');
    await expect(deviceMenu).toBeVisible();
    const menuBounds = await deviceMenu
      .locator('xpath=ancestor::div[contains(@class,"fixed")]')
      .boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width + 1);
    await page.mouse.click(10, 300);

    await openPatientClinicalTopic(page, 'R1', 'Ficha clínica');
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

test('keeps the census and movement sections complete in the printable view', async ({ page }) => {
  await seedCensus(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.locator('.census-movement-section')).toHaveCount(3);
  await page.emulateMedia({ media: 'print' });

  await expect(page.getByText(/Censo diario de servicios hospitalizados/i)).toBeVisible();
  await expect(page.locator('.census-toolbar')).toBeHidden();
  for (const section of await page.locator('.census-movement-section').all()) {
    await expect(section).toBeVisible();
    expect(await section.evaluate(element => getComputedStyle(element).overflowX)).toBe('visible');
  }
  const printableTable = page.locator('.census-table-scroll');
  expect(await printableTable.evaluate(element => getComputedStyle(element).overflowX)).toBe(
    'visible'
  );
  expect(
    await page
      .locator('[data-testid="patient-row"][data-bed-id="R1"] .census-diagnosis-cell .line-clamp-2')
      .evaluate(element => getComputedStyle(element).webkitLineClamp)
  ).not.toBe('2');
  // «Accesos» collapses on paper but stays a column, so empty and blocked rows still line up.
  const printedColumns = await printableTable.evaluate(element => {
    const table = element.querySelector('table')!;
    const header = table.querySelector('thead > tr:last-child')!;
    const access = header.querySelector('th.census-column-access')!;
    return {
      access: access.getBoundingClientRect().width,
      headerRight: header.lastElementChild!.getBoundingClientRect().right,
      tableRight: table.getBoundingClientRect().right,
    };
  });
  expect(printedColumns.access).toBeLessThanOrEqual(2);
  expect(Math.abs(printedColumns.tableRight - printedColumns.headerRight)).toBeLessThanOrEqual(2);

  await page.screenshot({
    path: test.info().outputPath('census-print-layout.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const pdf = await page.pdf({
    path: test.info().outputPath('census-print-layout.pdf'),
    format: 'A4',
    printBackground: true,
  });
  expect(pdf.byteLength).toBeGreaterThan(10_000);

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const printedPage = await document.getPage(pageNumber);
    const content = await printedPage.getTextContent();
    pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '));
  }
  for (const [heading, emptyMessage] of [
    ['Altas', 'Sin registros para el día seleccionado.'],
    ['Traslados', 'Sin registros para el día seleccionado.'],
    ['Hospitalización Diurna', 'Sin registros para el día seleccionado.'],
  ]) {
    const headingPage = pages.findIndex(content => content.includes(heading));
    expect(headingPage).toBeGreaterThanOrEqual(0);
    expect(pages[headingPage]).toContain(emptyMessage);
  }
});

test('keeps toolbar cards at their own height when opening monthly CUDYR', async ({ page }) => {
  await seedCensus(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.getByText(PATIENT, { exact: true })).toBeVisible();
  await expect(page.getByTestId('rayen-operations-bar')).toBeVisible();
  const cards = page
    .getByTestId('census-staff-and-sync')
    .locator('.census-toolbar-staff > .census-toolbar-card, [data-testid="rayen-operations-bar"]');
  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 832 });
    if (width >= 1024) {
      const bounds = await page
        .getByTestId('census-staff-and-sync')
        .locator(
          '.census-toolbar-staff > .census-toolbar-card, [data-testid="rayen-operations-bar"], [data-testid="census-summary-switcher"]'
        )
        .evaluateAll(elements =>
          elements.map(element => {
            const box = element.getBoundingClientRect();
            return { top: box.top, left: box.left, right: box.right };
          })
        );
      expect(bounds).toHaveLength(4);
      for (const box of bounds) {
        expect(Math.abs(box.top - bounds[0].top)).toBeLessThanOrEqual(1);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
    const before = await cards.evaluateAll(elements =>
      elements.map(el => el.getBoundingClientRect().height)
    );
    await page.getByRole('button', { name: 'Mostrar cumplimiento CUDYR mensual' }).click();
    await expect(page.getByRole('region', { name: 'Cumplimiento CUDYR mensual' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Mes de CUDYR' })).toBeVisible();
    const after = await cards.evaluateAll(elements =>
      elements.map(el => el.getBoundingClientRect().height)
    );
    expect(
      await page
        .getByTestId('census-summary-switcher')
        .evaluate(el => el.getBoundingClientRect().height)
    ).toBe(84);
    expect(after).toEqual([84, 84, 84]);
    const footer = page.getByTestId('cudyr-indicator-footer');
    await expect(footer).toBeVisible();
    expect(
      await footer.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return (
          el.scrollWidth <= el.clientWidth + 1 &&
          Array.from(el.children).every(child => {
            const rect = child.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          })
        );
      })
    ).toBe(true);
    await expect(page.getByTestId('census-summary-switcher')).not.toContainText(
      /Provisional|desde ago\./i
    );
    after.forEach((height, index) =>
      expect(Math.abs(height - before[index])).toBeLessThanOrEqual(1)
    );
    await page.getByRole('button', { name: 'Mostrar camas y movimientos' }).click();
  }
});

test('keeps the stale-day banner readable above the sticky table header while scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await seedCensus(page);
  await page.goto(`/?date=${DATE}`);
  await expect(page.getByText(PATIENT, { exact: true })).toBeVisible();
  const banner = page.locator('[data-app-top-bar][role="alert"]');
  await expect(banner).toBeVisible();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  const header = page.getByTestId('census-table').locator('thead');
  const [bannerBox, headerBox] = await Promise.all([banner.boundingBox(), header.boundingBox()]);
  expect(bannerBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  // The header sticks right under the banner instead of covering it.
  expect(headerBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);
  expect(headerBox!.y).toBeLessThanOrEqual(bannerBox!.y + bannerBox!.height + 2);
  await expect(banner.getByRole('button', { name: 'Ir a hoy' })).toBeVisible();
});
