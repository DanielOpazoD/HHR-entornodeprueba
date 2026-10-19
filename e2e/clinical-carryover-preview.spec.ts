import { expect, test } from '@playwright/test';
import { buildCanonicalE2ERecord, bootstrapSeededRecord } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';
import { buildInitializedDayRecord } from '../src/services/repositories/dailyRecordInitializationSupport';
import { applyClinicalDayCarryover } from '../src/services/repositories/clinicalDayCarryover';
import { calendarStampInClinicalTimeZone } from '../src/utils/clinicalTimeZone';
import { getPreviousDay } from '../src/utils/clinicalDayScheduleUtils';
import type { DailyRecord } from '../src/types/domain/dailyRecord';

test('shows copied clinical evidence as previous and pending after reload', async ({ page }) => {
  const today = calendarStampInClinicalTimeZone(new Date()).iso;
  const previous = getPreviousDay(today);
  const measured = getPreviousDay(previous);
  const source = buildCanonicalE2ERecord(previous) as unknown as DailyRecord;
  source.beds.R1 = {
    ...source.beds.R1,
    patientName: 'PACIENTE SINTETICO CARRYOVER',
    rut: '12345678-5',
    clinicalEpisodeId: 'synthetic-carryover-episode',
    admissionDate: measured,
    admissionTime: '08:00',
    devices: ['CUP'],
    deviceDetails: { CUP: { installationDate: previous } },
    vitalSigns: {
      recordedDate: measured,
      recordedAt: `${measured} 10:30`,
      heartRate: 72,
      systolic: null,
      diastolic: null,
      spo2: null,
      temperature: null,
      respiratoryRate: null,
      painEva: null,
      hgt: null,
      insulinUnits: null,
      insulinQuadrant: null,
      observations: null,
      author: 'Autor sintético',
      authorRole: 'Enfermería',
    },
  };
  const untouched = structuredClone(source);
  const copied = applyClinicalDayCarryover(buildInitializedDayRecord(today, source), source);
  expect(source).toEqual(untouched);
  expect(copied.beds.R1.vitalSigns?.recordedDate).toBe(measured);
  await installPreviewFirebaseRuntime(page);
  await bootstrapSeededRecord(page, {
    date: today,
    record: copied as unknown as Record<string, unknown>,
    role: 'admin',
    useRuntimeOverride: true,
    forceLocalOnlySync: true,
  });
  await page.goto(`/censo?date=${today}`);
  const row = page.locator('[data-testid="patient-row"][data-bed-id="R1"]').first();
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(row.getByText(`Medición previa: ${measured} · Por verificar`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText('Dispositivos previos · Por verificar')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Ver signos vitales' })).toContainText('72');
  }
});
