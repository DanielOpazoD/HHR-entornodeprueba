import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type {
  AdmissionEntry,
  ConflictEntry,
  DischargeEntry,
  RayenEncounter,
} from '@/features/rayen-import';
import { resolveReleasedBedPlacements } from '@/features/rayen-import/domain/resolveReleasedBedPlacements';

// Revisión adversarial de #314: al darle cama al conflicto de fecha inválida, una
// fila válida + una fila rota del MISMO RUN dejaban un conflicto de revisión en la
// cama y `hasSiblingConflict` vetaba la promoción del ingreso a una cama que el
// informe sí liberó (cama vacía en HHR, ingreso sin ubicar). Un conflicto de
// revisión sobre el RUN que egresa de esa cama no veta la cama.

const OCCUPANT_RUN = '11.111.111-1';

const incoming: RayenEncounter = {
  encounterId: '3001',
  run: '33.333.333-3',
  firstGivenName: 'Nuevo',
  firstFamilyName: 'Ingreso',
  service: 'Medicina',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-09-02T09:00:00-04:00',
};

const blockedAdmission: AdmissionEntry = {
  bedId: 'H5C1',
  patient: {
    ...EMPTY_PATIENT,
    bedId: 'H5C1',
    patientName: 'Nuevo Ingreso',
    rut: '33.333.333-3',
    clinicalEpisodeId: '3001',
  },
  isCma: false,
  source: incoming,
};

const occupiedConflict: ConflictEntry = {
  bedId: 'H5C1',
  rut: '33.333.333-3',
  patientName: 'Nuevo Ingreso',
  code: 'occupied-local-bed',
  blockedAdmission,
  reason: 'La cama H5C1 ya está ocupada por Pedro Legacy.',
  source: incoming,
};

const occupantDischarge: DischargeEntry = {
  bedId: 'H5C1',
  rut: OCCUPANT_RUN,
  patientName: 'Pedro Legacy',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: '1001',
};

const reviewConflict = (rut: string): ConflictEntry => ({
  bedId: 'H5C1',
  rut,
  patientName: 'Pedro Legacy',
  reason: `El informe de Gestión de Camas contiene una fecha/hora de egreso inválida para el RUN ${rut}; no se aplicó.`,
});

describe('resolveReleasedBedPlacements · conflicto de revisión sobre el RUN que egresa', () => {
  it('no veta la cama: el ingreso retenido se promueve y el conflicto sigue visible', () => {
    const review = reviewConflict(OCCUPANT_RUN);
    const result = resolveReleasedBedPlacements(
      [],
      [],
      [occupantDischarge],
      [occupiedConflict, review]
    );

    expect(result.admissions.map(entry => entry.patient.clinicalEpisodeId)).toEqual(['3001']);
    expect(result.conflicts).toEqual([review]);
  });

  it('un conflicto de revisión de OTRO RUN en la misma cama sigue vetando la promoción', () => {
    const review = reviewConflict('22.222.222-2');
    const result = resolveReleasedBedPlacements(
      [],
      [],
      [occupantDischarge],
      [occupiedConflict, review]
    );

    expect(result.admissions).toEqual([]);
    expect(result.conflicts).toEqual([occupiedConflict, review]);
  });

  it('un ocupante manual sin episodio (ocupante esperado observado) libera la cama por RUN; sin ocupante esperado sigue siendo desconocido', () => {
    const legacyDischarge: DischargeEntry = {
      ...occupantDischarge,
      encounterId: undefined,
      expectedOccupant: { rut: OCCUPANT_RUN, admissionDate: '2026-08-30', admissionTime: '09:00' },
    };
    const released = resolveReleasedBedPlacements([], [], [legacyDischarge], [occupiedConflict]);
    expect(released.admissions.map(entry => entry.patient.clinicalEpisodeId)).toEqual(['3001']);
    expect(released.conflicts).toEqual([]);

    const unknownProvenance: DischargeEntry = { ...occupantDischarge, encounterId: undefined };
    const kept = resolveReleasedBedPlacements([], [], [unknownProvenance], [occupiedConflict]);
    expect(kept.admissions).toEqual([]);
    expect(kept.conflicts).toEqual([occupiedConflict]);

    // Sin sello de ingreso el apply no podría verificar la identidad: la vista previa
    // no promete la promoción (sigue «unknown»).
    const unstamped: DischargeEntry = {
      ...legacyDischarge,
      expectedOccupant: { rut: OCCUPANT_RUN, admissionDate: '2026-08-30', admissionTime: '' },
    };
    const held = resolveReleasedBedPlacements([], [], [unstamped], [occupiedConflict]);
    expect(held.admissions).toEqual([]);
    expect(held.conflicts).toEqual([occupiedConflict]);
  });

  it.each([
    {
      name: 'el ingreso coincide con la huella esperada',
      incomingRun: OCCUPANT_RUN,
      reportRun: '22.222.222-2',
    },
    {
      name: 'el ingreso coincide con el RUN divergente del reporte',
      incomingRun: '22.222.222-2',
      reportRun: '22.222.222-2',
    },
  ])(
    'mantiene la cama bloqueada si reporte y huella divergen: $name',
    ({ incomingRun, reportRun }) => {
      const divergentAdmission: AdmissionEntry = {
        ...blockedAdmission,
        patient: { ...blockedAdmission.patient, rut: incomingRun },
        source: { ...incoming, run: incomingRun },
      };
      const divergentConflict: ConflictEntry = {
        ...occupiedConflict,
        rut: incomingRun,
        blockedAdmission: divergentAdmission,
      };
      const divergentDischarge: DischargeEntry = {
        ...occupantDischarge,
        rut: reportRun,
        encounterId: undefined,
        expectedOccupant: {
          rut: OCCUPANT_RUN,
          admissionDate: '2026-08-30',
          admissionTime: '09:00',
        },
      };

      const result = resolveReleasedBedPlacements(
        [],
        [],
        [divergentDischarge],
        [divergentConflict]
      );

      expect(result.admissions).toEqual([]);
      expect(result.conflicts).toEqual([divergentConflict]);
    }
  );
});
