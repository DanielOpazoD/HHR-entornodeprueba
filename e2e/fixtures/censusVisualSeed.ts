import type { Page } from '@playwright/test';
import { buildCanonicalE2ERecord, MOCK_USERS } from './auth';
import { installPreviewFirebaseRuntime, type FirebasePreviewConfig } from './previewFirebase';

/** Census day and the long-named patient of bed R1 the visual specs look at. */
export const VISUAL_DATE = process.env.E2E_FIXED_DATE ?? '2026-04-03';
export const VISUAL_PATIENT = 'MARÍA ANTONIETA DEL CARMEN PAKOMIO RIVERO';
export const VISUAL_SECOND_PATIENT = 'PACIENTE SINTÉTICA DE NOMBRE LARGO';

/** Seeds one census day with two synthetic patients so visual specs share the same screen. */
export const seedVisualCensus = async (
  page: Page,
  options: { includeClinicalDetails?: boolean; extraVitalReadings?: boolean } = {}
): Promise<void> => {
  const config = await installPreviewFirebaseRuntime(page);
  const base = buildCanonicalE2ERecord(VISUAL_DATE);
  const beds = base.beds as Record<string, Record<string, unknown>>;
  const record = buildCanonicalE2ERecord(VISUAL_DATE, {
    beds: {
      ...beds,
      R1: {
        ...beds.R1,
        patientName: VISUAL_PATIENT,
        rut: '12345678-5',
        clinicalEpisodeId: 'visual-episode',
        age: '44',
        ...(options.includeClinicalDetails
          ? {
              isIsolated: true,
              isolationType: 'Contacto',
              clinicalAlerts: [
                {
                  id: 'visual-alert',
                  text: 'Alerta clínica sintética del paciente',
                  recordedAt: `${VISUAL_DATE}T12:00`,
                  author: 'Profesional sintético',
                },
              ],
              fluidBalance: {
                censusDate: VISUAL_DATE,
                day: { intakeMl: 1200, urineOutputMl: 700, records: 2 },
                night: { intakeMl: 500, urineOutputMl: 400, records: 1 },
              },
              vitalSignsHistory: [
                {
                  recordedDate: VISUAL_DATE,
                  recordedAt: `${VISUAL_DATE} 08:00`,
                  systolic: 110,
                  diastolic: 70,
                  heartRate: 80,
                },
                {
                  recordedDate: VISUAL_DATE,
                  recordedAt: `${VISUAL_DATE} 12:00`,
                  systolic: 130,
                  diastolic: 82,
                  heartRate: 84,
                  spo2: 88,
                  temperature: 36.5,
                },
              ],
            }
          : {}),
        admissionDate: '2026-03-29',
        pathology:
          'Diagnóstico clínico sintético de descripción extensa para comprobar el ajuste de columnas',
        devices: ['VVP', 'VVP#2', 'Sonda Nasogástrica'],
        vitalSigns: {
          ...(options.extraVitalReadings
            ? { meanArterialPressure: 98, respiratoryRate: 18, painEva: 0 }
            : {}),
          recordedDate: VISUAL_DATE,
          recordedAt: `${VISUAL_DATE} 12:00`,
          systolic: 130,
          diastolic: 82,
          heartRate: 84,
          spo2: 88,
          temperature: 36.5,
        },
      },
      R2: {
        ...beds.R2,
        patientName: VISUAL_SECOND_PATIENT,
        rut: '12345678-5',
        clinicalEpisodeId: 'visual-episode-r2',
        age: '52',
        admissionDate: '2026-03-29',
        specialty: 'Medicina Interna',
      },
    },
  });

  await page.addInitScript(
    ({
      date,
      seededRecord,
      bootstrapUser,
      runtimeConfig,
    }: {
      date: string;
      seededRecord: unknown;
      bootstrapUser: unknown;
      runtimeConfig: FirebasePreviewConfig;
    }) => {
      const runtimeWindow = window as Window & { __HHR_E2E_OVERRIDE__?: Record<string, unknown> };
      runtimeWindow.__HHR_E2E_OVERRIDE__ = { [date]: seededRecord };
      localStorage.setItem('hhr_e2e_bootstrap_user', JSON.stringify(bootstrapUser));
      localStorage.setItem('firebase:authUser:test:[DEFAULT]', JSON.stringify({ uid: 'preview' }));
      localStorage.setItem('hhr_firebase_config', JSON.stringify(runtimeConfig));
      localStorage.setItem('hanga_roa_hospital_data', JSON.stringify({ [date]: seededRecord }));
    },
    {
      date: VISUAL_DATE,
      seededRecord: record,
      bootstrapUser: MOCK_USERS.admin,
      runtimeConfig: config,
    }
  );
};
