import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';
import { getTodayISO } from '../src/utils/dateCoreUtils';

const getTodayDate = () => getTodayISO();

const buildTransferSeedRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Transfer Candidate',
        pathology: 'Transfer DX',
        status: 'Estable',
      },
      R2: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R2,
        patientName: '',
        pathology: '',
        status: '',
      },
    },
  });

const openTransferFlow = async (page: Page) => {
  const date = getTodayDate();
  await bootstrapSeededRecord(page, {
    role: 'admin',
    date,
    record: buildTransferSeedRecord(date),
    useRuntimeOverride: true,
    forceEditableRecord: true,
  });
  await page.goto(`/traslados?date=${date}`);
  await ensureAuthenticated(page);
  await expect(page.locator('main')).toBeVisible({ timeout: 20000 });
};

test.describe('Patient Transfer Flow', () => {
  test.beforeEach(async ({ page }) => {
    await openTransferFlow(page);
  });

  test('should render transfer workspace with available patient context', async ({ page }) => {
    await expect(page.locator('main')).toContainText(/traslado|transfer/i);
    await expect(page.locator('main')).toContainText(
      /Sin registros para el día seleccionado|Traslados/i
    );
    await expect(page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first()).toBeVisible(
      {
        timeout: 10000,
      }
    );
  });
});
