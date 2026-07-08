import { describe, expect, it, vi } from 'vitest';
import {
  buildClinicalEpisodeKey,
  buildPatientPresenceSnapshot,
  classifyPatientMovementForRecord,
  resolveClinicalEpisode,
  resolveClinicalEpisodeAdmissionDate,
  resolveClinicalEpisodeIdentifier,
} from '@/application/patient-flow/clinicalEpisode';

describe('clinicalEpisode application model', () => {
  it('builds a canonical episode key', () => {
    expect(buildClinicalEpisodeKey('12.345.678-9', '2026-03-05')).toBe('12.345.678-9__2026-03-05');
  });

  it('separates same-day readmissions with different admission times', () => {
    expect(buildClinicalEpisodeKey('12.345.678-9', '2026-03-05', '08:00')).toBe(
      '12.345.678-9__2026-03-05__08:00'
    );
    expect(buildClinicalEpisodeKey('12.345.678-9', '2026-03-05', '18:30')).toBe(
      '12.345.678-9__2026-03-05__18:30'
    );
  });

  it('resolves a shared episode context from patient data', () => {
    const patient = {
      patientName: 'Paciente',
      rut: '11.111.111-1',
      admissionDate: '2026-03-05',
      firstSeenDate: '2026-03-04',
      specialty: 'medicina',
    };

    expect(
      resolveClinicalEpisode(patient, {
        sourceDailyRecordDate: '2026-03-06',
        sourceBedId: 'R1',
      })
    ).toMatchObject({
      patientRut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-04',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      episodeKey: '11.111.111-1__2026-03-04',
    });
  });

  it('prefers a persisted clinicalEpisodeId over the derived legacy tuple', () => {
    const patient = {
      clinicalEpisodeId: 'episode_2026_03_05_afternoon',
      patientName: 'Paciente',
      rut: '11.111.111-1',
      admissionDate: '2026-03-05',
      firstSeenDate: '2026-03-04',
      admissionTime: '18:30',
    };

    expect(resolveClinicalEpisodeIdentifier(patient)).toBe('episode_2026_03_05_afternoon');
    expect(resolveClinicalEpisode(patient).episodeKey).toBe('episode_2026_03_05_afternoon');
    expect(buildPatientPresenceSnapshot(patient, 'R1')?.episodeKey).toBe(
      'episode_2026_03_05_afternoon'
    );
  });

  it('records a fallback event when a patient has no persisted clinicalEpisodeId', () => {
    const recordFallback = vi.fn();
    const patient = {
      patientName: 'Paciente Legacy',
      rut: '11.111.111-1',
      firstSeenDate: '2026-03-05',
      admissionDate: '2026-03-05',
      admissionTime: '08:30',
    };

    expect(
      resolveClinicalEpisodeIdentifier(patient, {
        source: 'clinical_document',
        onFallback: recordFallback,
      })
    ).toBe('11.111.111-1__2026-03-05__08:30');
    expect(recordFallback).toHaveBeenCalledWith({
      source: 'clinical_document',
      reason: 'missing_clinical_episode_id',
      fallbackEpisodeKey: '11.111.111-1__2026-03-05__08:30',
      hasRut: true,
      hasAdmissionTime: true,
    });
  });

  it('builds presence snapshots and movement classification with shared rules', () => {
    const patient = {
      rut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-05',
      admissionTime: '02:00',
    };

    expect(buildPatientPresenceSnapshot(patient, 'R1')).toMatchObject({
      bedId: 'R1',
      episodeKey: '11.111.111-1__2026-03-05__02:00',
    });
    expect(classifyPatientMovementForRecord('2026-03-05', patient).isNewAdmission).toBe(true);
    expect(classifyPatientMovementForRecord('2026-03-06', patient).isNewAdmission).toBe(false);
  });

  it('keeps the first observed day as the admission anchor even when admissionDate is mistyped', () => {
    const patient = {
      rut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-05',
      admissionTime: '10:15',
    };

    expect(classifyPatientMovementForRecord('2026-03-05', patient).isNewAdmission).toBe(true);
    expect(classifyPatientMovementForRecord('2026-03-06', patient).isNewAdmission).toBe(false);
  });

  it('uses firstSeenDate to preserve same-day ingreso when admission time is missing', () => {
    const patient = {
      rut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-05',
      firstSeenDate: '2026-03-05',
    };

    expect(classifyPatientMovementForRecord('2026-03-05', patient).isNewAdmission).toBe(true);
    expect(classifyPatientMovementForRecord('2026-03-06', patient).isNewAdmission).toBe(false);
  });

  it('prioritizes the earlier clinical-turn day over a later firstSeenDate for madrugada admissions', () => {
    const patient = {
      rut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-06',
      admissionTime: '02:00',
    };

    expect(classifyPatientMovementForRecord('2026-03-05', patient).isNewAdmission).toBe(true);
    expect(classifyPatientMovementForRecord('2026-03-06', patient).isNewAdmission).toBe(false);
  });

  it('assigns a madrugada X+1 admission without hour only to the previous night shift when first seen on X', () => {
    const patient = {
      rut: '11.111.111-1',
      patientName: 'Paciente',
      admissionDate: '2026-03-06',
      firstSeenDate: '2026-03-05',
    };

    expect(classifyPatientMovementForRecord('2026-03-05', patient).isNewAdmission).toBe(true);
    expect(classifyPatientMovementForRecord('2026-03-06', patient).isNewAdmission).toBe(false);
  });

  it('prefers the first observed census day for active episode anchors', () => {
    expect(
      resolveClinicalEpisodeAdmissionDate({
        rut: '33.333.333-3',
        patientName: 'Paciente',
        admissionDate: '2026-03-09',
        firstSeenDate: '2026-03-07',
      })
    ).toBe('2026-03-07');
  });

  it('accepts the minimal episode contract without full patient shape', () => {
    expect(
      buildPatientPresenceSnapshot(
        {
          rut: '22.222.222-2',
          patientName: 'Contrato Mínimo',
          admissionDate: '2026-03-07',
        },
        'R2'
      )
    ).toMatchObject({
      patientRut: '22.222.222-2',
      patientName: 'Contrato Mínimo',
      episodeKey: '22.222.222-2__2026-03-07',
    });
  });

  // -----------------------------------------------------------------------
  // Legacy patients (no firstSeenDate)
  // -----------------------------------------------------------------------

  describe('legacy patients without firstSeenDate', () => {
    it('uses admissionDate as fallback anchor on admission day', () => {
      const patient = {
        rut: '11.111.111-1',
        patientName: 'Paciente Legacy',
        admissionDate: '2026-04-10',
        // no firstSeenDate — legacy patient
      };

      expect(classifyPatientMovementForRecord('2026-04-10', patient).isNewAdmission).toBe(true);
    });

    it('does not show as new admission on subsequent days', () => {
      const patient = {
        admissionDate: '2026-04-10',
      };

      expect(classifyPatientMovementForRecord('2026-04-11', patient).isNewAdmission).toBe(false);
      expect(classifyPatientMovementForRecord('2026-04-12', patient).isNewAdmission).toBe(false);
    });

    it('handles legacy patient whose name was changed on X+1', () => {
      // Patient admitted day X, name changed day X+1 — still no firstSeenDate
      const patient = {
        admissionDate: '2026-04-10',
        // firstSeenDate was never set because patient had identity before feature existed
      };

      // Day X: should be new
      expect(classifyPatientMovementForRecord('2026-04-10', patient).isNewAdmission).toBe(true);
      // Day X+1: NOT new (even after name change)
      expect(classifyPatientMovementForRecord('2026-04-11', patient).isNewAdmission).toBe(false);
    });

    it('falls back to clinical day logic when neither firstSeenDate nor admissionDate exist', () => {
      const patient = {
        // completely empty — edge case
      };

      expect(classifyPatientMovementForRecord('2026-04-10', patient).isNewAdmission).toBe(false);
    });

    it('uses admissionDate for same-day readmission without firstSeenDate', () => {
      const patient = {
        admissionDate: '2026-04-10',
        admissionTime: '14:00',
        // no firstSeenDate
      };

      expect(classifyPatientMovementForRecord('2026-04-10', patient).isNewAdmission).toBe(true);
    });
  });
});
