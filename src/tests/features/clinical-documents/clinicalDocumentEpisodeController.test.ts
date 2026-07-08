import { describe, expect, it, vi } from 'vitest';

import {
  buildClinicalDocumentEpisodeContext,
  buildClinicalDocumentEpisodeLookupKeys,
  buildClinicalDocumentPatientFieldValues,
  buildClinicalEpisodeKey,
  getCurrentDateValue,
  getCurrentTimeValue,
} from '@/features/clinical-documents/controllers/clinicalDocumentEpisodeController';
import { DataFactory } from '@/tests/factories/DataFactory';

const { recordOperationalTelemetryMock } = vi.hoisted(() => ({
  recordOperationalTelemetryMock: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: recordOperationalTelemetryMock,
}));

describe('clinicalDocumentEpisodeController', () => {
  it('builds a stable episode key from rut and admission date', () => {
    expect(buildClinicalEpisodeKey('12.345.678-9', '2026-03-04')).toBe('12.345.678-9__2026-03-04');
  });

  it('builds a patient episode context from census data', () => {
    const patient = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-04',
    });
    const context = buildClinicalDocumentEpisodeContext(patient, '2026-03-04', 'R1');

    expect(context.patientRut).toBe(patient.rut);
    expect(context.patientName).toBe(patient.patientName);
    expect(context.sourceDailyRecordDate).toBe('2026-03-04');
    expect(context.sourceBedId).toBe('R1');
    expect(context.episodeKey).toContain(patient.rut);
    expect(context.admissionDate).toBe('2026-03-04');
  });

  it('uses only the canonical episode id for clinical document lookup when available', () => {
    const patient = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep_canonical_1',
      rut: '11.111.111-1',
      admissionDate: '2026-03-06',
      admissionTime: '11:45',
      firstSeenDate: '2026-03-04',
    });

    const keys = buildClinicalDocumentEpisodeLookupKeys(patient, 'ep_canonical_1');

    expect(keys).toEqual(['ep_canonical_1']);
  });

  it('uses legacy episode key fallbacks only when a canonical episode id is not available', () => {
    const patient = DataFactory.createMockPatient('R1', {
      rut: '11.111.111-1',
      admissionDate: '2026-03-06',
      admissionTime: '11:45',
      firstSeenDate: '2026-03-04',
    });

    const keys = buildClinicalDocumentEpisodeLookupKeys(patient, '11.111.111-1__2026-03-04__11:45');

    expect(keys).toEqual([
      '11.111.111-1__2026-03-04__11:45',
      '11111111-1__2026-03-04__11:45',
      '11.111.111-1__2026-03-04',
      '11111111-1__2026-03-04',
    ]);
  });

  it('records degraded telemetry when clinical documents fall back to a legacy episode key', () => {
    const patient = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: undefined,
      admissionDate: '2026-03-06',
      admissionTime: '11:45',
      firstSeenDate: '2026-03-04',
    });

    buildClinicalDocumentEpisodeContext(patient, '2026-03-04', 'R1');

    expect(recordOperationalTelemetryMock).toHaveBeenCalledWith({
      category: 'clinical_document',
      operation: 'clinical_episode_key_fallback',
      status: 'degraded',
      runtimeState: 'degraded',
      date: '2026-03-04',
      issues: ['Clinical document episode resolved without clinicalEpisodeId.'],
      context: expect.objectContaining({
        source: 'clinical_document',
        fallbackEpisodeKey: expect.stringContaining('__2026-03-04__11:45'),
        hasRut: true,
        hasAdmissionTime: true,
        sourceBedId: 'R1',
      }),
    });
  });

  it('prefills clinical document patient fields from the patient record', () => {
    const patient = DataFactory.createMockPatient('R1', {
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-04',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T13:45:00.000Z'));

    const values = buildClinicalDocumentPatientFieldValues(patient);

    expect(values.nombre).toBe(patient.patientName);
    expect(values.rut).toBe(patient.rut);
    expect(values.fing).toBe('2026-03-04');
    expect(values.finf).toBe(getCurrentDateValue());
    expect(values.hinf).toBe(getCurrentTimeValue());
    vi.useRealTimers();
  });

  it('prefers the configured discharge date as Fecha de alta when the episode is closed', () => {
    const patient = {
      ...DataFactory.createMockPatient('R1', {
        admissionDate: '2026-04-01',
      }),
      dischargeDate: '2026-04-11',
    };

    const values = buildClinicalDocumentPatientFieldValues(patient);

    expect(values.finf).toBe('2026-04-11');
  });

  it('uses episodeClosureDate as Fecha de alta before falling back to today', () => {
    const patient = {
      ...DataFactory.createMockPatient('R1', {
        admissionDate: '2026-04-01',
      }),
      episodeClosureDate: '2026-04-12',
      dischargeDate: '2026-04-11',
    };

    const values = buildClinicalDocumentPatientFieldValues(patient);

    expect(values.finf).toBe('2026-04-12');
  });
});
