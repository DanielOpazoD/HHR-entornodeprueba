import { describe, expect, it } from 'vitest';
import {
  EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS,
  PENDING_LOCAL_CENSUS_PATCH_FIELDS,
  isSameEpisodeForExplicitCensusPatch,
} from '@/services/repositories/explicitLocalCensusPatchPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

type Patient = DailyRecord['beds'][string];

const patient = (overrides: Partial<Patient>): Patient =>
  ({
    bedId: 'R1',
    patientName: 'Paciente Test',
    rut: '11.111.111-1',
    admissionDate: '2026-02-18',
    admissionTime: '08:00',
    ...overrides,
  }) as Patient;

describe('explicitLocalCensusPatchPolicy', () => {
  it('keeps the explicit and pending clinical census field lists aligned', () => {
    const expectedClinicalFields = [
      'pathology',
      'diagnosisComments',
      'snomedCode',
      'cie10Code',
      'cie10Description',
      'specialty',
      'secondarySpecialty',
      'status',
      'ginecobstetriciaType',
      'deliveryRoute',
      'deliveryDate',
      'deliveryCesareanLabor',
      'isUPC',
      'upcChecklist',
      'surgicalComplication',
    ];

    expect(Array.from(EXPLICIT_LOCAL_CENSUS_PATCH_FIELDS).sort()).toEqual(
      [...expectedClinicalFields].sort()
    );
    expect(Array.from(PENDING_LOCAL_CENSUS_PATCH_FIELDS).sort()).toEqual(
      [...expectedClinicalFields].sort()
    );
  });

  it('matches the same persisted clinical episode id', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: 'episode-r1' }),
        patient({ clinicalEpisodeId: ' episode-r1 ' })
      )
    ).toBe(true);
  });

  it('falls back to the episode tuple when only one side has a clinical episode id', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: 'ep_episode-r1' }),
        patient({ clinicalEpisodeId: undefined })
      )
    ).toBe(true);
  });

  it('falls back to the episode tuple when a canonical id meets a deterministic legacy id', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: 'ep_remote-canonical' }),
        patient({ clinicalEpisodeId: 'legacy_ep_localhash' })
      )
    ).toBe(true);
  });

  it('rejects different persisted canonical episode ids before tuple fallback', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: 'ep_remote-canonical' }),
        patient({ clinicalEpisodeId: 'ep_local-canonical' })
      )
    ).toBe(false);
  });

  it('rejects a one-sided clinical episode id when the fallback tuple belongs to another same-day admission', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: 'ep_episode-r1', admissionTime: '15:30' }),
        patient({ clinicalEpisodeId: undefined, admissionTime: '08:00' })
      )
    ).toBe(false);
  });

  it('matches legacy episodes by rut, admission date and admission time', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: undefined }),
        patient({ clinicalEpisodeId: undefined })
      )
    ).toBe(true);
  });

  it('rejects same-rut same-day re-admissions with different admission time', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: undefined, admissionTime: '15:30' }),
        patient({ clinicalEpisodeId: undefined, admissionTime: '08:00' })
      )
    ).toBe(false);
  });

  it('uses name and admission anchor only when rut is unavailable on both sides', () => {
    expect(
      isSameEpisodeForExplicitCensusPatch(
        patient({ clinicalEpisodeId: undefined, rut: '', patientName: 'Paciente Sin Rut' }),
        patient({ clinicalEpisodeId: undefined, rut: '', patientName: ' paciente sin rut ' })
      )
    ).toBe(true);
  });
});
