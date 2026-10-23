import { expect, test } from '@playwright/test';
import { buildCanonicalE2ERecord, bootstrapSeededRecord } from './fixtures/auth';
import { installPreviewFirebaseRuntime } from './fixtures/previewFirebase';
import { buildInitializedDayRecord } from '../src/services/repositories/dailyRecordInitializationSupport';
import { applyClinicalDayCarryover } from '../src/services/repositories/clinicalDayCarryover';
import { calendarStampInClinicalTimeZone } from '../src/utils/clinicalTimeZone';
import { getPreviousDay } from '../src/utils/clinicalDayScheduleUtils';
import type { DailyRecord } from '../src/types/domain/dailyRecord';

test('keeps copied evidence dates internal without census footers after reload', async ({
  page,
}, testInfo) => {
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
  expect(copied.beds.R1.clinicalCarryover).toMatchObject({
    sourceDate: previous,
    vitalsPending: true,
    devicesPending: true,
  });
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
    const vitals = row.getByRole('button', { name: 'Ver signos vitales' });
    await expect(vitals).toBeVisible({ timeout: 30_000 });
    await expect(vitals.locator('time')).toHaveCount(0);
    await expect(vitals).not.toHaveAttribute('title');
    await expect(vitals).not.toHaveAttribute('aria-description');
    await expect(
      row.getByText(/Previa|Censo del|Por verificar|pendiente de verificar/i)
    ).toHaveCount(0);
    await expect(vitals).not.toContainText(measured.split('-').reverse().join('/'));
    const stored = await page.evaluate(date => {
      const record = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}')[date];
      return record?.beds.R1;
    }, today);
    expect(stored.vitalSigns.recordedDate).toBe(measured);
    expect(stored.deviceDetails.CUP.installationDate).toBe(previous);
    expect(stored.clinicalCarryover).toMatchObject({
      sourceDate: previous,
      vitalsPending: true,
      devicesPending: true,
    });
    await expect(vitals).toContainText('72');
  }
  await testInfo.attach('clinical-carryover-row', {
    body: await row.screenshot(),
    contentType: 'image/png',
  });
});
