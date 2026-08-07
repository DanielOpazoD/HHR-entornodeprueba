import { describe, expect, it } from 'vitest';

import { buildMedicalHandoffSpreadsheetRows } from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { HandoffPatientContract } from '@/domain/handoff/patientContracts';
import { BedType, type BedDefinition } from '@/types/domain/beds';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const beds: BedDefinition[] = [
  { id: 'R1', name: 'R1', type: BedType.MEDIA, isCuna: false },
  { id: 'R2', name: 'R2', type: BedType.MEDIA, isCuna: false },
  { id: 'R3', name: 'R3', type: BedType.MEDIA, isCuna: false },
];

const createPatient = (
  overrides: Partial<HandoffPatientContract> = {}
): HandoffPatientContract => ({
  bedId: 'R1',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Uno',
  rut: '11.111.111-1',
  age: '52a',
  pathology: 'Diagnóstico principal',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-08-07',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const createRecord = (recordBeds: Record<string, HandoffPatientContract>): DailyRecord => ({
  date: '2026-08-07',
  beds: recordBeds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-08-07T10:00:00.000Z',
  activeExtraBeds: [],
});

describe('medicalHandoffSpreadsheetController', () => {
  it('exports only occupied non-blocked beds and omits the RUT', () => {
    const record = createRecord({
      R1: createPatient({
        clinicalEpisodeId: 'episode-101',
        treatingPhysicianName: 'Dra. Aravena',
      }),
      R2: createPatient({ bedId: 'R2', isBlocked: true, patientName: 'Bloqueada' }),
      R3: createPatient({ bedId: 'R3', patientName: '   ' }),
    });

    const rows = buildMedicalHandoffSpreadsheetRows(record, beds);

    expect(rows).toEqual([
      {
        stableKey: 'episode:episode-101',
        bed: 'R1',
        patientName: 'Paciente Uno',
        age: '52a',
        diagnosis: 'Diagnóstico principal',
        specialty: Specialty.MEDICINA,
        treatingPhysician: 'Dra. Aravena',
      },
    ]);
    expect(rows[0]).not.toHaveProperty('rut');
  });

  it('includes a companion newborn as a separate handoff row', () => {
    const crib = createPatient({
      bedId: 'R1-CUNA',
      bedMode: 'Cuna',
      patientName: 'RN de Paciente Uno',
      age: '1d',
      pathology: 'Recién nacido sano',
      specialty: Specialty.PEDIATRIA,
      clinicalEpisodeId: 'episode-rn-202',
    });
    const record = createRecord({
      R1: createPatient({ hasCompanionCrib: true, clinicalCrib: crib }),
    });

    const rows = buildMedicalHandoffSpreadsheetRows(record, beds.slice(0, 1));

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      stableKey: 'episode:episode-rn-202',
      bed: 'Cuna RN (R1)',
      patientName: 'RN de Paciente Uno',
    });
  });

  it('builds a deterministic fallback key without exposing the RUT', () => {
    const record = createRecord({
      R1: createPatient({ clinicalEpisodeId: undefined, rut: '22.222.222-2' }),
    });

    const first = buildMedicalHandoffSpreadsheetRows(record, beds.slice(0, 1));
    const second = buildMedicalHandoffSpreadsheetRows(record, beds.slice(0, 1));

    expect(first[0].stableKey).toBe('bed:r1:paciente-uno');
    expect(second[0].stableKey).toBe(first[0].stableKey);
    expect(JSON.stringify(first)).not.toContain('22.222.222-2');
  });
});
