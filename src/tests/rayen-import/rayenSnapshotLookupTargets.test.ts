import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import';
import { collectEgresoLookupTargets } from '@/features/rayen-import/hooks/rayenSnapshotLookupTargets';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';

const diff = {
  pendingAdministrativeDischarges: [
    {
      bedId: 'R2',
      rut: 'P1234567',
      documentType: 'Pasaporte',
      patientName: 'Paciente Sintético',
      signal: 'missing-from-ficha',
      encounterId: '990001',
      verification: {
        medicalEpicrisis: 'unknown',
        nursingEpicrisis: 'unknown',
        hospitalDischarge: 'unknown',
      },
    },
  ],
} as CensusImportDiff;

describe('collectEgresoLookupTargets', () => {
  it('forwards passport metadata and does not collapse another letter prefix', () => {
    expect(
      collectEgresoLookupTargets(diff, [
        {
          run: 'Q1234567',
          documentType: 'Pasaporte',
          encounterId: '990001',
        },
      ])
    ).toEqual([
      {
        run: 'P1234567',
        documentType: 'Pasaporte',
        encounterId: '990001',
      },
    ]);
  });

  it('keeps a checksum-valid legacy numeric identifier untyped through snapshot to lookup', () => {
    const { patient } = rayenToPatientData({
      encounterId: '990010',
      run: '123456785',
      firstGivenName: 'Paciente',
      firstFamilyName: 'Sintético',
      room: 'R2',
      bed: 'R2',
    });
    const pending = {
      ...diff,
      pendingAdministrativeDischarges: [
        {
          ...diff.pendingAdministrativeDischarges[0],
          rut: patient.rut,
          documentType: patient.documentType,
          encounterId: patient.clinicalEpisodeId,
        },
      ],
    };

    expect(patient.rut).toBe('123456785');
    expect(patient.documentType).toBeUndefined();
    expect(collectEgresoLookupTargets(pending)).toEqual([
      { run: '123456785', documentType: undefined, encounterId: '990010' },
    ]);
  });
});
