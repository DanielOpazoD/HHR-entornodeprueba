import { describe, expect, it } from 'vitest';
import {
  feasiblePrincipalMoveSourceBedIds,
  rayenToPatientData,
  type RayenEncounter,
} from '@/features/rayen-import';
import {
  blockedPrincipalMoveConflict,
  finalizeAdmissionsAgainstAcceptedMoves,
} from '@/features/rayen-import/domain/principalBedMovePlan';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 24);
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '142040',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'Neo 1',
  bed: 'Neo1',
  admissionDatetime: '2026-07-23T13:21:41-06:00',
  ...overrides,
});
const patientAt = (source: RayenEncounter, bedId: string): PatientData => ({
  ...rayenToPatientData(source, REFERENCE).patient,
  bedId,
});
const recordWith = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-24',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

describe('principal bed move planning', () => {
  it('rejects an admission when the expected source-bed move was not accepted', () => {
    const source = encounter({ encounterId: '142099', run: '222222222' });
    const patient = patientAt(source, 'NEO1');
    const current = recordWith({ NEO1: patientAt(encounter(), 'NEO1') });
    const admission = { bedId: 'NEO1', patient, isCma: false, source };

    expect(finalizeAdmissionsAgainstAcceptedMoves(current, [admission], [])).toMatchObject({
      admissions: [],
      conflicts: [{ bedId: 'NEO1', code: 'occupied-local-bed' }],
    });
    expect(
      finalizeAdmissionsAgainstAcceptedMoves(
        current,
        [admission],
        [
          {
            fromBedId: 'NEO1',
            toBedId: 'H2C2',
            rut: '111111111',
            patientName: 'Paciente Anterior',
            source: encounter(),
          },
        ]
      ).admissions
    ).toEqual([admission]);
  });

  it('supports a chain ending in a free bed and a closed swap', () => {
    const occupied = new Set(['NEO1', 'H2C2']);
    expect(
      feasiblePrincipalMoveSourceBedIds(
        [
          { sourceBedId: 'NEO1', targetBedId: 'H2C2' },
          { sourceBedId: 'H2C2', targetBedId: 'H2C1' },
        ],
        occupied
      )
    ).toEqual(new Set(['NEO1', 'H2C2']));
    expect(
      feasiblePrincipalMoveSourceBedIds(
        [
          { sourceBedId: 'NEO1', targetBedId: 'H2C2' },
          { sourceBedId: 'H2C2', targetBedId: 'NEO1' },
        ],
        occupied
      )
    ).toEqual(new Set(['NEO1', 'H2C2']));
  });

  it('rejects a blocked chain and duplicate destination claims', () => {
    expect(
      feasiblePrincipalMoveSourceBedIds(
        [
          { sourceBedId: 'NEO1', targetBedId: 'H2C2' },
          { sourceBedId: 'H2C2', targetBedId: 'H2C1' },
        ],
        new Set(['NEO1', 'H2C2', 'H2C1'])
      )
    ).toEqual(new Set());
    expect(
      feasiblePrincipalMoveSourceBedIds(
        [
          { sourceBedId: 'NEO1', targetBedId: 'H2C2' },
          { sourceBedId: 'H2C1', targetBedId: 'H2C2' },
        ],
        new Set(['NEO1', 'H2C1'])
      )
    ).toEqual(new Set());
  });

  it('keeps a duplicate-target move visible even when the target bed is free', () => {
    const source = encounter();
    const movingPatient = patientAt(source, 'NEO1');

    expect(
      blockedPrincipalMoveConflict(
        recordWith({ NEO1: movingPatient }),
        'NEO1',
        'H2C2',
        movingPatient,
        source
      )
    ).toMatchObject({
      bedId: 'H2C2',
      code: 'principal-bed-collision',
      blockedMove: { fromBedId: 'NEO1', toBedId: 'H2C2' },
    });
  });
});
