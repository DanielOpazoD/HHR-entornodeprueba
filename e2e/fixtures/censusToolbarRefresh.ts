import { expect, test, type Page } from '@playwright/test';

// Hold a real production chunk until assertions finish; do not depend on network timing.
const holdChunk = async (page: Page, pattern: RegExp) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(pattern, async route => {
    await ready;
    await route.continue();
  });
  return release;
};

const TOOLBAR_CONTROLS = [
  '[title="Opciones de guardado"]',
  '[title="Enviar censo"]',
  '[aria-label="Documentos"]',
  '[aria-label="Más opciones del censo"]',
  '[aria-label="Ir a hoy"]',
];

const toolbarGeometry = (page: Page) =>
  page.locator('[data-app-top-bar]:has([title="Enviar censo"])').evaluate(
    (bar, selectors) =>
      selectors.map(selector => {
        const button = bar.querySelector(selector);
        if (!button) throw new Error(`Missing toolbar control: ${selector}`);
        const { x, y, width, height } = button.getBoundingClientRect();
        return {
          selector,
          x,
          y,
          width,
          height,
          font: getComputedStyle(button).font,
          spacing: getComputedStyle(button).letterSpacing,
        };
      }),
    TOOLBAR_CONTROLS
  );

const assertGeometry = (
  before: Awaited<ReturnType<typeof toolbarGeometry>>,
  after: typeof before
) => {
  for (let index = 0; index < before.length; index++) {
    expect(after[index].selector).toBe(before[index].selector);
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(after[index][dimension] - before[index][dimension]),
        `${before[index].selector} ${dimension}`
      ).toBeLessThanOrEqual(1);
    }
  }
};

export const checkCensusToolbarRefresh = async (page: Page, date: string) => {
  // Start from the populated census, as an operator pressing F5 does. This also
  // separates toolbar replacement from an unrelated cold webfont substitution.
  await page.goto(`/census?date=${date}`);
  await expect(page.getByTestId('rayen-import-button')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await page.addInitScript(selectors => {
    const observer = new MutationObserver(() => {
      const bar = document.querySelector('[data-app-top-bar][inert]');
      if (!bar || selectors.some(selector => !bar.querySelector(selector))) return;
      (window as unknown as { __toolbarBootstrap: unknown }).__toolbarBootstrap = selectors.map(
        selector => {
          const button = bar.querySelector(selector)!;
          const { x, y, width, height } = button.getBoundingClientRect();
          return {
            selector,
            x,
            y,
            width,
            height,
            font: getComputedStyle(button).font,
            spacing: getComputedStyle(button).letterSpacing,
          };
        }
      );
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  }, TOOLBAR_CONTROLS);
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const releaseRayen = await holdChunk(page, /\/assets\/RayenImportButton-[^/]+\.js$/);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const bar = page.locator('[data-app-top-bar]:has([title="Enviar censo"])');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __toolbarBootstrap?: unknown }).__toolbarBootstrap
        )
      )
      .toBeTruthy();
    const bootstrap = await page.evaluate(
      () =>
        (window as unknown as { __toolbarBootstrap: Awaited<ReturnType<typeof toolbarGeometry>> })
          .__toolbarBootstrap
    );
    await expect(bar).not.toHaveAttribute('inert');
    await expect(page.getByTestId('rayen-operations-loading')).toBeVisible();
    await expect(
      page.getByTestId('census-table').locator('thead').getByTestId('census-attention-filter-scale')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mostrar cumplimiento CUDYR mensual' })
    ).toBeVisible();
    await expect(page.getByTestId('specialty-actions')).toHaveCount(0);
    const staff = page.getByTestId('census-staff-and-sync');
    const loading = await staff.boundingBox();
    const loadingSync = await page
      .getByTestId('rayen-operations-loading')
      .getByRole('button', { name: 'Sincronizar', exact: true })
      .boundingBox();
    await test
      .info()
      .attach('toolbar-sync-loading', { body: await page.screenshot(), contentType: 'image/png' });
    releaseRayen();
    await expect(page.getByTestId('rayen-import-button')).toBeVisible();
    await expect(page.getByTestId('clinical-library-quick-action')).toBeVisible();
    await expect(page.getByTestId('conflict-versions-button')).toBeVisible();
    await test.info().attach('toolbar-geometry', {
      body: JSON.stringify({ bootstrap, ready: await toolbarGeometry(page) }, null, 2),
      contentType: 'application/json',
    });
    assertGeometry(bootstrap, await toolbarGeometry(page));
    expect(await staff.boundingBox()).toEqual(loading);
    const readySync = await page.getByTestId('rayen-import-button').boundingBox();
    expect(loadingSync).not.toBeNull();
    expect(readySync).not.toBeNull();
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(readySync![dimension] - loadingSync![dimension]),
        `sync ${dimension}`
      ).toBeLessThanOrEqual(1);
    }
    await test
      .info()
      .attach('toolbar-ready', { body: await page.screenshot(), contentType: 'image/png' });
    // F5 uses the same origin and persisted browser state; chunk routes keep cache disabled.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rayen-import-button')).toBeVisible();
    await expect(page.getByTestId('conflict-versions-button')).toBeVisible();
    await test.info().attach('toolbar-geometry', {
      body: JSON.stringify({ bootstrap, ready: await toolbarGeometry(page) }, null, 2),
      contentType: 'application/json',
    });
    assertGeometry(bootstrap, await toolbarGeometry(page));
    expect(failures).toEqual([]);
  } finally {
    releaseRayen();
  }
};
