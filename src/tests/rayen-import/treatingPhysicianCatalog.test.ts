import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  assignProfessionalSpecialty,
  findProfessionalByRayenIdentity,
  mergeDiscoveredTreatingPhysicians,
  professionalCatalogKey,
  resolveVisibleTreatingPhysicianName,
} from '@/services/staff/treatingPhysicianCatalog';
import { enrichSnapshotWithTreatingPhysicianSpecialties } from '@/features/rayen-import/domain/enrichTreatingPhysicianSnapshot';
import { diffSyncablePatientFields } from '@/features/rayen-import/domain/patientSyncPolicy';
import { summarizeTreatingPhysicianSourceQuality } from '@/features/rayen-import/domain/rayenSyncSourceQuality';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { PatientData } from '@/types/domain/patient';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-30T12:00:00.000Z',
  facilityId: 1342,
  encounters: [
    {
      encounterId: '141336',
      run: '123456785',
      firstGivenName: 'Ana',
      firstFamilyName: 'Paciente',
      treatingPhysicianId: '7947',
      treatingPhysicianName: 'Angelica Vargas',
    },
  ],
  physicians: [{ practitionerId: '7947', displayName: 'Angelica Vargas' }],
};

const patient = (overrides: Partial<PatientData> = {}): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'H1C1',
  patientName: 'Ana Paciente',
  rut: '12.345.678-5',
  specialty: 'Cirugía',
  ...overrides,
});

describe('treating physician catalog', () => {
  it('assigns a specialty by stable Rayen identity without changing other physicians', () => {
    const catalog: ProfessionalCatalogItem[] = [
      {
        name: 'Angelica Vargas',
        phone: '',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
      {
        name: 'Daniel Bahamonde',
        phone: '',
        specialty: 'Cirugía',
        rayenPractitionerId: '8001',
        source: 'rayen',
      },
    ];

    expect(assignProfessionalSpecialty(catalog, 'rayen:7947', 'Psiquiatría')).toEqual([
      { ...catalog[0], specialty: 'Psiquiatría' },
      catalog[1],
    ]);
    expect(catalog[0].specialty).toBeUndefined();
  });

  it('keeps same-name manual professionals independently addressable by phone', () => {
    const catalog: ProfessionalCatalogItem[] = [
      { name: 'Alex Soto', phone: '111' },
      { name: 'Alex Soto', phone: '222' },
    ];
    const firstKey = professionalCatalogKey(catalog[0]);
    const secondKey = professionalCatalogKey(catalog[1]);

    expect(firstKey).not.toBe(secondKey);
    expect(assignProfessionalSpecialty(catalog, secondKey, 'Cirugía')).toEqual([
      catalog[0],
      { ...catalog[1], specialty: 'Cirugía' },
    ]);
  });

  it('does not replace an unknown stable id with a same-name Rayen physician', () => {
    const catalog: ProfessionalCatalogItem[] = [
      {
        name: 'Alex Soto',
        phone: '',
        specialty: 'Cirugía',
        rayenPractitionerId: 'known-id',
        source: 'rayen',
      },
    ];

    expect(findProfessionalByRayenIdentity(catalog, 'different-id', 'Alex Soto')).toBeUndefined();
    expect(findProfessionalByRayenIdentity(catalog, undefined, 'Alex Soto')).toEqual(catalog[0]);
  });

  it('only presents physicians whose catalog entry has an assigned specialty', () => {
    const catalog: ProfessionalCatalogItem[] = [
      {
        name: 'Ariki Merino',
        phone: '',
        rayenPractitionerId: 'pending-specialty',
        source: 'rayen',
      },
      {
        name: 'Angelica Vargas',
        phone: '',
        specialty: 'Psiquiatría',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
    ];

    expect(resolveVisibleTreatingPhysicianName(catalog, 'pending-specialty', 'Ariki Merino')).toBe(
      ''
    );
    expect(resolveVisibleTreatingPhysicianName(catalog, '7947', 'Nombre capturado')).toBe(
      'Angelica Vargas'
    );
    expect(resolveVisibleTreatingPhysicianName(catalog, 'unknown', 'Angelica Vargas')).toBe('');
  });

  it('discovers a physician once and preserves a locally configured specialty', () => {
    const current: ProfessionalCatalogItem[] = [
      {
        name: 'Angelica Vargas',
        phone: '',
        specialty: 'Psiquiatría',
        rayenPractitionerId: '7947',
        source: 'rayen',
      },
    ];

    expect(mergeDiscoveredTreatingPhysicians(current, snapshot.physicians ?? [])).toEqual({
      catalog: current,
      changed: false,
    });
  });

  it('keeps a same-name manual entry separate from a newly discovered Rayen identity', () => {
    const result = mergeDiscoveredTreatingPhysicians(
      [{ name: 'Angelica Vargas', phone: '123', specialty: 'Psiquiatría' }],
      snapshot.physicians ?? []
    );

    expect(result.changed).toBe(true);
    expect(result.catalog).toEqual(
      expect.arrayContaining([
        {
          name: 'Angelica Vargas',
          phone: '123',
          specialty: 'Psiquiatría',
        },
        expect.objectContaining({
          name: 'Angelica Vargas',
          rayenPractitionerId: '7947',
          source: 'rayen',
        }),
      ])
    );
  });

  it('preserves a name-only manual physician when Rayen has no assignment', () => {
    const current = patient({
      treatingPhysicianId: undefined,
      treatingPhysicianName: 'Médico manual',
      specialty: 'Cirugía',
    });
    const incoming = patient({
      treatingPhysicianId: undefined,
      treatingPhysicianName: undefined,
      specialty: '',
    });

    expect(diffSyncablePatientFields(current, incoming)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'treatingPhysicianName' })])
    );
  });

  it('enriches the planning snapshot from the stable id', () => {
    const enriched = enrichSnapshotWithTreatingPhysicianSpecialties(snapshot, [
      {
        name: 'Nombre distinto permitido',
        phone: '',
        specialty: 'Psiquiatría',
        rayenPractitionerId: '7947',
      },
    ]);

    expect(enriched.encounters[0].treatingPhysicianSpecialty).toBe('Psiquiatría');
  });

  it('restores a missing display name from the persistent catalog using the stable id', () => {
    const missingNameSnapshot: RayenCensusSnapshot = {
      ...snapshot,
      encounters: [{ ...snapshot.encounters[0], treatingPhysicianName: undefined }],
    };
    const enriched = enrichSnapshotWithTreatingPhysicianSpecialties(missingNameSnapshot, [
      {
        name: 'Angelica Vargas',
        phone: '',
        specialty: 'Psiquiatría',
        rayenPractitionerId: '7947',
      },
    ]);

    expect(enriched.encounters[0]).toMatchObject({
      treatingPhysicianName: 'Angelica Vargas',
      treatingPhysicianSpecialty: 'Psiquiatría',
    });
    expect(summarizeTreatingPhysicianSourceQuality(missingNameSnapshot, enriched)).toEqual({
      encounters: 1,
      catalogEntries: 1,
      assignedEncounters: 1,
      sourceResolvedNames: 0,
      plannedResolvedNames: 1,
    });
  });

  it('converts the legacy internal-medicine catalog label to the HHR census label', () => {
    const enriched = enrichSnapshotWithTreatingPhysicianSpecialties(snapshot, [
      {
        name: 'Angelica Vargas',
        phone: '',
        specialty: 'Medicina Interna',
        rayenPractitionerId: '7947',
      },
    ]);

    expect(enriched.encounters[0].treatingPhysicianSpecialty).toBe('Med Interna');
  });

  it('never erases a manual specialty when the physician mapping is pending', () => {
    const current = patient({
      treatingPhysicianId: 'old',
      treatingPhysicianName: 'Médico anterior',
      specialty: 'Cirugía',
    });
    const incoming = patient({
      treatingPhysicianId: '7947',
      treatingPhysicianName: 'Angelica Vargas',
      specialty: '',
    });
    const changes = diffSyncablePatientFields(current, incoming);

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'treatingPhysicianId', to: '7947' }),
        expect.objectContaining({ field: 'treatingPhysicianName', to: 'Angelica Vargas' }),
      ])
    );
    expect(changes.some(change => change.field === 'specialty')).toBe(false);
  });

  it('does not erase a verified name when the same stable id is temporarily unresolved', () => {
    const current = patient({
      treatingPhysicianId: '7947',
      treatingPhysicianName: 'Angelica Vargas',
    });
    const incoming = patient({
      treatingPhysicianId: '7947',
      treatingPhysicianName: undefined,
    });

    expect(diffSyncablePatientFields(current, incoming)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'treatingPhysicianName' })])
    );
  });
});
