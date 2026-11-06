import { expect, test } from '@playwright/test';
import { seedVisualCensus, VISUAL_DATE } from './fixtures/censusVisualSeed';
import { panelResult } from '../src/tests/views/census/clinicalPanelDrawer.fixture';

test('reads a long clinical history in batches and keeps the full history available', async ({
  page,
}) => {
  await seedVisualCensus(page);
  const panel = {
    ...panelResult,
    events: [
      {
        ...panelResult.events[0],
        shiftChangeResume: [],
        evolutionResume: Array.from({ length: 1500 }, (_, i) => ({
          id: 100 + i,
          OBE_NOTES: `Nota sintética ${i + 1}`,
          HCPR_NAME: i % 2 ? 'Enfermera(o)' : 'Médico',
          OBE_PUBLISH_DATETIME: '2026-07-13T09:00:00',
        })),
      },
    ],
  };
  await page.addInitScript(response => {
    window.addEventListener('message', event => {
      if (event.data?.type !== 'HHR_RAYEN_CLINICAL_PANEL_REQUEST') return;
      window.postMessage(
        { ...response, type: 'HHR_RAYEN_CLINICAL_PANEL_RESULT', reqId: event.data.reqId },
        window.location.origin
      );
    });
  }, panel);
  await page.goto(`/?date=${VISUAL_DATE}`);
  await page.getByTestId('clinical-panel-trigger-R1').click();
  await page
    .getByTestId('clinical-panel-drawer-R1')
    .getByRole('button', { name: /Abrir explorador clínico de/ })
    .click();
  const notes = page.getByRole('region', { name: 'Evoluciones', exact: true });
  await expect(notes.getByRole('article')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Evoluciones', exact: true }).click();
  await expect(notes.getByRole('article')).toHaveCount(20);
  await expect(notes.getByRole('status')).toHaveText('Mostrando 20 de 1500');
  await notes.getByRole('button', { name: 'Mostrar 20 más' }).click();
  await expect(notes.getByRole('article')).toHaveCount(40);
  await notes.getByRole('button', { name: 'Médico (750)' }).click();
  await expect(notes.getByRole('article')).toHaveCount(20);
  await notes.getByRole('button', { name: 'Mostrar todas' }).click();
  await expect(notes.getByRole('article')).toHaveCount(750);
  await expect(notes.getByRole('status')).toHaveText('Mostrando 750 de 750');
  await page.getByRole('button', { name: 'Volver al censo' }).click();
  await expect(page.locator('.census-register')).toBeVisible();
});
