// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  reconcileCensus,
  rayenToPatientData,
  mapRayenBed,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty } from '@/types/domain/patientClassification';
import { CLINICAL_CRIB_PARENT_BEDS } from '@/features/rayen-import/mapping/bedMapping';

interface ClinicalCribRuntime {
  parentBedIdFromLabel: (value: string) => string | null;
  buildAssignments: (value: unknown[]) => Array<{
    encounterId: string;
    parentBedId: string;
    cribBedId: string;
  }>;
  buildActiveBedAssignments: (value: unknown[]) => Array<{
    encounterId: string;
    bedId: string;
  }>;
  enrichSnapshot: <
    T extends { encounters: Array<{ encounterId?: string; bed?: string; room?: string }> },
  >(
    snapshot: T,
    assignments: Array<{ encounterId: string; parentBedId: string }>
  ) => T;
  enrichSnapshotRequest: (
    response: Promise<{
      snapshot: { encounters: Array<{ encounterId?: string; bed?: string; room?: string }> };
    }>,
    gestionCamasRuntime: Record<string, (...args: unknown[]) => unknown>,
    fetchWithTimeout: (...args: unknown[]) => Promise<unknown>
  ) => Promise<{
    snapshot: { encounters: Array<{ encounterId?: string; bed?: string; room?: string }> };
  }>;
}

interface ActiveBedsRuntime {
  bedIdFromLabel: (value: string) => string | null;
  buildAssignments: (
    value: unknown[],
    isClinicalCrib: (record: Record<string, unknown>) => boolean
  ) => Array<{ encounterId: string; bedId: string }>;
}

const context = vm.createContext({});
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-active-beds.js'), 'utf8'),
  context
);
vm.runInContext(
  readFileSync(path.resolve('extension/gestion-camas-clinical-cribs.js'), 'utf8'),
  context
);
const runtime = (context as unknown as { HhrGestionCamasClinicalCribs: ClinicalCribRuntime })
  .HhrGestionCamasClinicalCribs;
const activeBedsRuntime = (context as unknown as { HhrGestionCamasActiveBeds: ActiveBedsRuntime })
  .HhrGestionCamasActiveBeds;
describe('Gestión de Camas clinical-crib mapping', () => {
  it.each([...CLINICAL_CRIB_PARENT_BEDS])(
    'imports a newly created %s crib through verified extension evidence without duplicates',
    parentBedId => {
      const reference = new Date(2026, 6, 8);
      const mother: RayenEncounter = {
        encounterId: '900001',
        run: '144700554',
        firstGivenName: 'Madre',
        firstFamilyName: 'Prueba',
        birthDate: '1980-01-01',
        service: 'Área Médico Quirúrgica Indiferenciada',
        room: parentBedId,
        bed: parentBedId,
        admissionDatetime: '2026-07-08T10:00:00-06:00',
        diagnosis: 'Control',
      };
      const child: RayenEncounter = {
        ...mother,
        encounterId: '900002',
        run: '222222222',
        firstGivenName: 'Bebe',
        birthDate: '2026-07-08',
        room: 'Cunas',
        bed: `C${parentBedId}`,
      };
      const captured: RayenCensusSnapshot = {
        capturedAt: '2026-07-08T20:00:00-06:00',
        facilityId: 1342,
        encounters: [mother, child],
      };
      const snapshot = runtime.enrichSnapshot(
        captured,
        runtime.buildAssignments([
          { name: `Cuna ${parentBedId}`, shortName: `C${parentBedId}`, encounterId: 900002 },
        ])
      );
      expect(snapshot.encounters[1]).toMatchObject({ clinicalCribParentBedId: parentBedId });
      const current: DailyRecord = {
        date: '2026-07-08',
        beds: { [parentBedId]: rayenToPatientData(mother, reference).patient },
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '',
        activeExtraBeds: [],
      };
      const diff = reconcileCensus(current, snapshot, { reference });
      expect(diff.conflicts).toHaveLength(0);
      const imported = applyCensusImportDiff(current, diff, {
        idFactory: () => 'synthetic-crib',
        now: reference,
        syncRunId: `new-${parentBedId}-crib`,
      }).record;
      expect(imported.beds[parentBedId]).toMatchObject({
        clinicalEpisodeId: mother.encounterId,
        clinicalCrib: { clinicalEpisodeId: child.encounterId, specialty: Specialty.PEDIATRIA },
      });
      const repeated = reconcileCensus(imported, snapshot, { reference });
      expect(repeated.conflicts).toHaveLength(0);
      expect(repeated.admissions).toHaveLength(0);
      expect(repeated.updates).toHaveLength(0);
    }
  );

  it('keeps the extension inventory and normalization contract aligned with the app', () => {
    const extensionInventory = [...CLINICAL_CRIB_PARENT_BEDS];
    for (const parentBedId of extensionInventory) {
      const label = `Cuna ${parentBedId}`;
      expect(runtime.parentBedIdFromLabel(label)).toBe(parentBedId);
      expect(mapRayenBed({ bed: label, clinicalCribParentBedId: parentBedId })).toMatchObject({
        bedId: parentBedId,
        isClinicalCrib: true,
      });
    }
  });

  it('wires the verified bed inventory into the snapshot route', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    expect(background).toContain("'gestion-camas-active-beds.js'");
    expect(background).toContain("'gestion-camas-clinical-cribs.js'");
    const activeBedsSource = readFileSync(
      path.resolve('extension/gestion-camas-active-beds.js'),
      'utf8'
    );
    expect(activeBedsSource).toContain('/facility/${encodeURIComponent(record.facId)}/beds');
    expect(background).toContain('HhrGestionCamasClinicalCribs.enrichSnapshotRequest(');
  });

  it.each([
    ['CH1C1', 'H1C1'],
    ['CH1C2', 'H1C2'],
    ['CH2C1', 'H2C1'],
    ['CH2C2', 'H2C2'],
    ['CH3C1', 'H3C1'],
    ['CH3C2', 'H3C2'],
    ['CH4C1', 'H4C1'],
    ['CH4C2', 'H4C2'],
    ['CH5C1', 'H5C1'],
    ['CH5C2', 'H5C2'],
    ['CH6C1', 'H6C1'],
    ['CH6C2', 'H6C2'],
    ['C-R1', 'R1'],
    ['C-R2', 'R2'],
    ['C-R3', 'R3'],
    ['C-R4', 'R4'],
    ['CNEO1', 'NEO1'],
    ['CNeo2', 'NEO2'],
  ])('maps a crib %s to parent bed %s', (label, parentBedId) => {
    expect(runtime.parentBedIdFromLabel(label)).toBe(parentBedId);
  });

  it('accepts the descriptive Gestion de Camas name without treating a principal bed as a crib', () => {
    expect(runtime.parentBedIdFromLabel('Cuna H5C1')).toBe('H5C1');
    expect(runtime.parentBedIdFromLabel('H5C1')).toBeNull();
  });

  it('projects current physical occupancy by episode and excludes attached cribs', () => {
    expect(activeBedsRuntime.bedIdFromLabel('CMA R2')).toBe('R2');
    expect(activeBedsRuntime.bedIdFromLabel('Cama H2C2')).toBe('H2C2');
    expect(
      runtime.buildActiveBedAssignments([
        { name: 'Cama H2C2', shortName: 'H2C2', encounterId: 142201 },
        { name: 'CMA R2', shortName: 'CMAR2', encounterId: 142202 },
        { name: 'Cuna H5C1', shortName: 'CH5C1', encounterId: 142203 },
      ])
    ).toEqual([
      { encounterId: '142201', bedId: 'H2C2' },
      { encounterId: '142202', bedId: 'R2' },
    ]);
  });

  it('rejects unknown physical parents and ignores free records', () => {
    expect(runtime.parentBedIdFromLabel('Cuna H7C1')).toBeNull();
    expect(
      runtime.buildAssignments([
        { name: 'Cuna H5C1', shortName: 'CH5C1', encounterId: 141814 },
        { name: 'Cuna R1', shortName: 'C-R1', encounterId: 0 },
        { name: 'Cuna H7C1', shortName: 'CH7C1', encounterId: 999 },
      ])
    ).toEqual([{ encounterId: '141814', parentBedId: 'H5C1', cribBedId: 'CH5C1' }]);
  });

  it('adds only the verified parent relation to the matching Ficha encounter', () => {
    const snapshot = {
      capturedAt: '2026-07-20T13:00:00-06:00',
      encounters: [
        { encounterId: '141814', bed: 'CH5C1' },
        { encounterId: '141815', bed: 'CH7C1' },
      ],
    };

    expect(
      runtime.enrichSnapshot(snapshot, [
        { encounterId: '141814', parentBedId: 'H5C1' },
        { encounterId: '141815', parentBedId: 'H7C1' },
      ])
    ).toEqual({
      ...snapshot,
      encounters: [
        { encounterId: '141814', bed: 'CH5C1', clinicalCribParentBedId: 'H5C1' },
        { encounterId: '141815', bed: 'CH7C1' },
      ],
    });
  });

  it('does not join a later bed assignment to a snapshot captured before a crib move', () => {
    const snapshot = { encounters: [{ encounterId: '141814', bed: 'CH5C2' }] };
    expect(
      runtime.enrichSnapshot(snapshot, [{ encounterId: '141814', parentBedId: 'H5C1' }])
    ).toEqual(snapshot);
  });

  it('enriches from an authenticated bed inventory and degrades safely when unavailable', async () => {
    const snapshotResponse = {
      snapshot: { encounters: [{ encounterId: '141814', bed: 'CH5C1' }] },
    };
    const gestionCamasRuntime = {
      resolveSession: async () => ({
        record: { apiBase: 'https://hospital.test/api', facId: 1342, token: 'secret' },
      }),
      classifyRejection: async () => 'forbidden',
      markSessionVerified: async () => true,
    };
    const fetchWithTimeout = async () => ({
      ok: true,
      json: async () => [
        { shortName: 'CH5C1', encounterId: 141814 },
        { shortName: 'R2', encounterId: 141900 },
      ],
    });

    await expect(
      runtime.enrichSnapshotRequest(
        Promise.resolve(snapshotResponse),
        gestionCamasRuntime,
        fetchWithTimeout
      )
    ).resolves.toEqual({
      snapshot: {
        encounters: [
          {
            encounterId: '141814',
            bed: 'CH5C1',
            clinicalCribParentBedId: 'H5C1',
          },
        ],
        activeBedAssignments: [{ encounterId: '141900', bedId: 'R2' }],
      },
    });

    await expect(
      runtime.enrichSnapshotRequest(
        Promise.resolve(snapshotResponse),
        { ...gestionCamasRuntime, resolveSession: async () => ({ record: null }) },
        async () => {
          throw new Error('must not fetch');
        }
      )
    ).resolves.toEqual(snapshotResponse);

    await expect(
      runtime.enrichSnapshotRequest(
        Promise.resolve(snapshotResponse),
        {
          ...gestionCamasRuntime,
          resolveSession: async () => {
            throw new Error('storage');
          },
        },
        async () => {
          throw new Error('must not fetch');
        }
      )
    ).resolves.toEqual(snapshotResponse);
  });
});
