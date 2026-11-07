import { expect, test } from '@playwright/test';
import { seedVisualCensus, VISUAL_DATE } from './fixtures/censusVisualSeed';

for (const width of [1440, 390]) {
  test(`recovers earlier MMRAD studies while the laboratory tunnel is unavailable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await seedVisualCensus(page);
    await page.route('**/firestore.googleapis.com/**', route => route.abort());
    await page.route('**/.netlify/functions/syslab-proxy?*', route =>
      route.fulfill({
        status: 503,
        json: {
          success: false,
          connected: false,
          error: 'Synthetic laboratory tunnel unavailable',
        },
      })
    );
    await page.route('**/.netlify/functions/mmrad-search?*', route => {
      const params = new URL(route.request().url()).searchParams;
      return route.fulfill({
        json: {
          rut: params.get('rut'),
          examenes: params.get('from')
            ? []
            : [
                {
                  nombre_examen: 'TAC previo sintético',
                  fecha_examen: '01/03/2026 10:00',
                  fecha_asignacion: '01/03/2026',
                  mod: 'CT',
                  estado: 'Validado',
                  pdf_url: null,
                  dicom_url: null,
                  informe_html_url: null,
                  report: null,
                },
              ],
        },
      });
    });
    await page.goto(`/censo?date=${VISUAL_DATE}`);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('clinical-panel-trigger-R1').click();
    const drawer = page.getByTestId('clinical-panel-drawer-R1');
    await drawer.getByRole('button', { name: /Abrir explorador clínico de/ }).click();
    const imaging = page.getByRole('region', { name: 'Imágenes' });
    await expect(
      imaging.getByText(
        'Sin estudios de imágenes desde el ingreso. Puede haber exámenes anteriores.'
      )
    ).toBeVisible();
    const history = imaging.getByRole('checkbox', {
      name: 'Incluir exámenes anteriores al ingreso',
    });
    await history.focus();
    await page.keyboard.press('Space');
    await expect(imaging.getByText('TAC previo sintético')).toBeVisible();
    await expect(
      imaging.getByText(/Período: todo el historial disponible en MMRAD, hasta hoy/)
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await imaging.screenshot({ path: info.outputPath(`mmrad-history-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
