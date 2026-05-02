import { test, expect } from '@playwright/test';
import {
  bootstrapSeededRecord,
  buildCanonicalE2ERecord,
  ensureAuthenticated,
} from './fixtures/auth';

const getTodayDate = () => new Date().toISOString().slice(0, 10);

const buildMedicalSignatureRecord = (date: string) =>
  buildCanonicalE2ERecord(date, {
    beds: {
      ...(buildCanonicalE2ERecord(date).beds as Record<string, unknown>),
      R1: {
        ...(buildCanonicalE2ERecord(date).beds as Record<string, Record<string, unknown>>).R1,
        patientName: 'Medical Signature Patient',
        pathology: 'Signature DX',
        status: 'Estable',
      },
    },
  });

test.describe('Medical Signature Flow', () => {
  test('complete journey: sender signs -> link generated -> receiver signs', async ({ page }) => {
    const date = getTodayDate();
    await bootstrapSeededRecord(page, {
      role: 'admin',
      date,
      record: buildMedicalSignatureRecord(date),
      useRuntimeOverride: true,
      forceEditableRecord: true,
    });

    await page.goto(`/censo?date=${date}`);
    await ensureAuthenticated(page);
    await expect(page.getByTestId('census-table')).toBeVisible({ timeout: 20000 });

    const medicalHandoffBtn = page.getByTestId('nav-tab-medical-handoff');
    await expect(medicalHandoffBtn).toBeVisible({ timeout: 10000 });
    await medicalHandoffBtn.click();

    await expect(page.getByTestId('medical-handoff-share-links-button')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('medical-handoff-share-links-button')).toBeVisible({
      timeout: 10000,
    });
  });
});
