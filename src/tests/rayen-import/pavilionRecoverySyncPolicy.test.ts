import { describe, expect, it } from 'vitest';
import { reconcileCensus } from '@/features/rayen-import/domain/reconcileCensus';
import {
  isPavilionRecoveryEncounter,
  isPavilionRecoveryLocation,
} from '@/features/rayen-import/domain/pavilionRecoverySyncPolicy';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';

const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'enc-pr-1',
  run: '186585704',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Pabellón',
  service: 'Recuperación Pabellón',
  room: 'Pabellón-R1',
  bed: 'P-R1',
  ...overrides,
});

const record = (beds: DailyRecord['beds'] = {}): DailyRecord =>
  ({
    date: '2026-07-31',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-31T09:00:00.000Z',
  }) as DailyRecord;

const snapshot = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-31T10:00:00.000Z',
  facilityId: 1342,
  encounters,
  isComplete: true,
});

describe('pavilion recovery synchronization policy', () => {
  it('recognizes the two temporary pavilion recovery positions', () => {
    expect(isPavilionRecoveryLocation('P-R1')).toBe(true);
    expect(isPavilionRecoveryLocation('Pabellón-R2')).toBe(true);
    expect(isPavilionRecoveryLocation('Área quirúrgica indiferenciada / Pabellón-R1 / P-R1')).toBe(
      true
    );
    expect(isPavilionRecoveryLocation('R1')).toBe(false);
    expect(isPavilionRecoveryEncounter(encounter())).toBe(true);
  });

  it('does not import or clinically enrich active P-R1/P-R2 encounters', () => {
    const diff = reconcileCensus(
      record(),
      snapshot([
        encounter(),
        encounter({ encounterId: 'enc-pr-2', bed: 'P-R2', room: 'Pabellón-R2' }),
      ])
    );

    expect(diff.admissions).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.moves).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.pendingAdministrativeDischarges).toEqual([]);
    expect(diff.activeClinicalEpisodeIds).toEqual([]);
  });

  it('does not restore or discharge closed P-R1/P-R2 encounters', () => {
    const current = record({
      'P-R1': {
        bedId: 'P-R1',
        patientName: 'Paciente Pabellón Uno',
        rut: '18.658.570-4',
        clinicalEpisodeId: 'enc-pr-1',
      } as DailyRecord['beds'][string],
      'P-R2': {
        bedId: 'P-R2',
        patientName: 'Paciente Pabellón Dos',
        rut: '20.236.052-1',
        clinicalEpisodeId: 'enc-pr-2',
      } as DailyRecord['beds'][string],
    });
    const captured = snapshot([
      encounter({ hasMedicalDischarge: true }),
      encounter({
        encounterId: 'enc-pr-2',
        run: '202360521',
        room: 'H2',
        bed: 'C1',
        dischargeDatetime: '2026-07-31T09:30:00.000Z',
      }),
    ]);
    captured.activeBedAssignments = [{ encounterId: 'enc-pr-2', bedId: 'P-R2' }];

    const diff = reconcileCensus(current, captured);

    expect(diff.admissions).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.moves).toEqual([]);
    expect(diff.discharges).toEqual([]);
    expect(diff.pendingAdministrativeDischarges).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.activeClinicalEpisodeIds).toEqual([]);
    expect(diff.unchangedCount).toBe(0);
  });

  it('does not warn when a previously local episode is temporarily visible in P-R1', () => {
    const localPatient = {
      bedId: 'H1C1',
      patientName: 'Paciente Pabellón',
      rut: '18.658.570-4',
      clinicalEpisodeId: 'enc-pr-1',
    } as DailyRecord['beds'][string];
    const diff = reconcileCensus(record({ H1C1: localPatient }), snapshot([encounter()]));

    expect(diff.pendingAdministrativeDischarges).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.activeClinicalEpisodeIds).toEqual([]);
  });
});
