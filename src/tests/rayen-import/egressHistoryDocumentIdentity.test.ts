import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  ConflictEntry,
  DischargeEntry,
} from '@/features/rayen-import/contracts/censusImportDiff';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { matchesDischargeSubject } from '@/features/rayen-import/domain/dischargeSubjectIdentity';
import { applyReviewedPatientChanges } from '@/features/rayen-import/domain/patientSyncPolicy';
import { resolveReleasedBedPlacements } from '@/features/rayen-import/domain/resolveReleasedBedPlacements';
import { pushUniqueConflict } from '@/features/rayen-import/domain/egresoReportConflicts';
import { selectEligibleEgresoRows } from '@/features/rayen-import/domain/egresoReportEligibility';

const patient = (rut: string): PatientData => ({
  ...rayenToPatientData(
    {
      encounterId: 'SYNTHETIC',
      run: rut,
      firstGivenName: 'SINTETICO',
      firstFamilyName: 'PRUEBA',
      birthDate: '1980-01-01',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'H5',
      bed: 'C1',
      admissionDatetime: '2026-07-08T10:00:00-06:00',
    },
    new Date('2026-07-08T20:00:00Z')
  ).patient,
  clinicalEpisodeId: undefined,
});
const discharge = (rut: string): DischargeEntry => ({
  bedId: 'H5C1',
  rut,
  patientName: 'SINTETICO REPORTE',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
});

describe.each([
  ['different documents', 'P123456785', '12.345.678-5', false],
  ['same RUT', '123456785', '12.345.678-5', true],
  ['same passport', 'P123456785', 'p123456785', true],
] as const)('%s without episode', (_label, stored, reported, same) => {
  it('discharge guard requires the same document and admission stamp', () => {
    const occupant = patient(stored);
    expect(
      matchesDischargeSubject(occupant, {
        ...discharge(reported),
        expectedOccupant: {
          rut: reported,
          admissionDate: occupant.admissionDate,
          admissionTime: occupant.admissionTime,
        },
      })
    ).toBe(same);
  });
  it('crib update preserves manual decisions only for the same document', () => {
    const old = {
      ...patient(stored),
      specialty: 'Medicina',
      diagnosisManualOverride: true,
      pathology: 'DIAGNOSTICO MANUAL SINTETICO',
    };
    const incoming = {
      ...patient(reported),
      specialty: 'Pediatria',
      pathology: 'DIAGNOSTICO NUEVO SINTETICO',
    };
    const parent = { ...patient('11.111.111-1'), clinicalCrib: old };
    const result = applyReviewedPatientChanges(parent, parent, [
      { field: 'clinicalCrib', from: old, to: incoming },
    ]);
    expect(result.clinicalCrib?.specialty).toBe(same ? old.specialty : incoming.specialty);
    expect(result.clinicalCrib?.pathology).toBe(same ? old.pathology : incoming.pathology);
    expect(result.clinicalCrib?.diagnosisManualOverride).toBe(same ? true : undefined);
  });
  it('released placement cancels only the discharged document', () => {
    const conflict: ConflictEntry = {
      code: 'occupied-local-bed',
      bedId: 'H5C1',
      reason: 'CAMA SINTETICA OCUPADA',
      blockedAdmission: { bedId: 'H5C1', patient: patient(stored), isCma: false },
    };
    const result = resolveReleasedBedPlacements([], [], [discharge(reported)], [conflict]);
    expect(result.conflicts).toEqual(same ? [] : [conflict]);
    expect(result.admissions).toEqual([]);
    expect(result.moves).toEqual([]);
  });
  it('conflict deduplication keeps distinct documents', () => {
    const first: ConflictEntry = {
      bedId: 'H5C1',
      rut: stored,
      patientName: 'SINTETICO',
      reason: 'REVISION SINTETICA',
    };
    const second = { ...first, rut: reported };
    const conflicts = [first];
    pushUniqueConflict(conflicts, second);
    expect(conflicts).toEqual(same ? [first] : [first, second]);
  });
  it.each(['bed', 'crib'] as const)(
    'unverified report does not attribute another document to the %s occupant',
    location => {
      const occupant = { ...patient(stored), patientName: 'OCUPANTE SINTETICO' };
      const record: DailyRecord = {
        date: '2026-07-08',
        beds: {
          H5C1:
            location === 'bed' ? occupant : { ...patient('11.111.111-1'), clinicalCrib: occupant },
        },
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '',
        activeExtraBeds: [],
      };
      const result = selectEligibleEgresoRows(
        createEmptyCensusImportDiff(true),
        [
          {
            run: reported,
            patientName: 'REPORTE SINTETICO',
            bedLabel: 'H5C1',
            fechaEgreso: 'INVALID',
            exactEpisodeVerification: 'unverified',
            servicio: '',
            edad: '',
            destino: '',
            motivo: '',
          },
        ],
        record
      );
      expect(result.diff.conflicts[0]?.patientName).toBe(
        same ? occupant.patientName : 'REPORTE SINTETICO'
      );
      expect(result.rows).toEqual([]);
      expect(result.diff.discharges).toEqual([]);
    }
  );
});
