import type ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import {
  buildCensusEmailRequestBody,
  stripDerivedClinicalSync,
} from '@/services/integrations/censusEmailRequestPayload';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

// Synthetic stand-ins for what the clinical sync derives per bed (shape irrelevant to the workbook).
const derived = (): Partial<PatientData> =>
  ({
    clinicalSyncCheckpoint: { capturedAt: '2026-03-05T08:00:00Z', source: 'x'.repeat(4000) },
    vitalSignsHistory: Array.from({ length: 40 }, (_, i) => ({ at: `08:${i}`, heartRate: 80 + i })),
    evaluationScores: { braden: 18, notes: 'y'.repeat(2000) },
  }) as unknown as Partial<PatientData>;

const patient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: `Paciente sintético ${bedId}`,
  rut: '11.111.111-1',
  age: '30',
  pathology: 'Patología sintética',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-01',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...derived(),
  ...overrides,
});

const day = (date: string): DailyRecord =>
  ({
    date,
    beds: {
      [BEDS[0].id]: patient(BEDS[0].id, {
        patientName: 'Madre sintética',
        hasCompanionCrib: true,
        clinicalCrib: patient('C1', { patientName: 'RN sintético', rut: '', age: '0' }),
      }),
      [BEDS[1].id]: patient(BEDS[1].id, {
        patientName: 'Paciente con pasaporte',
        rut: 'X123456789',
        documentType: 'Pasaporte',
      } as Partial<PatientData>),
      [BEDS[2].id]: { ...patient(BEDS[2].id), isBlocked: true, patientName: '', rut: '' },
    },
    discharges: [
      {
        id: `d-${date}`,
        bedName: BEDS[3].name,
        bedId: BEDS[3].id,
        bedType: 'Cama',
        patientName: 'Alta sintética',
        rut: '22.222.222-2',
        diagnosis: 'Dx',
        time: '10:00',
        status: 'Vivo',
        originalData: patient(BEDS[3].id, { patientName: 'Alta sintética' }),
      },
    ],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T12:00:00Z`,
    nurses: [],
    activeExtraBeds: [],
    rayenSyncHistory: [{ id: `run-${date}`, status: 'applied', detail: 'z'.repeat(3000) }],
  }) as unknown as DailyRecord;

const month = ['2026-03-04', '2026-03-05', '2026-03-06'].map(day);

const sheetSnapshot = (workbook: ExcelJS.Workbook) =>
  workbook.worksheets.map(sheet => {
    const cells: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) =>
      row.eachCell({ includeEmpty: false }, (cell, colNumber) =>
        cells.push(`${rowNumber}:${colNumber}=${JSON.stringify(cell.value)}`)
      )
    );
    return {
      name: sheet.name,
      state: sheet.state,
      merges: [...((sheet.model as { merges?: string[] }).merges ?? [])].sort(),
      cells,
    };
  });

describe('census email payload slimming', () => {
  it('builds exactly the same workbook without the derived clinical-sync data', async () => {
    const full = await buildCensusMasterWorkbook(month);
    const slim = await buildCensusMasterWorkbook(month.map(stripDerivedClinicalSync));
    expect(sheetSnapshot(slim)).toEqual(sheetSnapshot(full));
  });

  it('drops only the derived fields, at bed, crib, movement and day level', () => {
    const slim = stripDerivedClinicalSync(month[0]);
    const mother = slim.beds[BEDS[0].id];
    for (const holder of [mother, mother.clinicalCrib, slim.discharges[0].originalData]) {
      expect(holder).not.toHaveProperty('clinicalSyncCheckpoint');
      expect(holder).not.toHaveProperty('vitalSignsHistory');
      expect(holder).not.toHaveProperty('evaluationScores');
    }
    expect(slim).not.toHaveProperty('rayenSyncHistory');
    // Identities are copied as they are: the newborn stays its own patient, the passport stays a passport.
    expect(mother.patientName).toBe('Madre sintética');
    expect(mother.clinicalCrib?.patientName).toBe('RN sintético');
    expect(slim.beds[BEDS[1].id].rut).toBe('X123456789');
    expect(slim.discharges[0].patientName).toBe('Alta sintética');
    expect(slim.beds[BEDS[2].id].isBlocked).toBe(true);
    // The input record is not mutated.
    expect(month[0].beds[BEDS[0].id]).toHaveProperty('vitalSignsHistory');
  });

  it('sends a much smaller request body', () => {
    const body = buildCensusEmailRequestBody({
      date: '2026-03-06',
      records: month,
      recipients: ['sintetico@hospital.invalid'],
    });
    const fullBytes = new TextEncoder().encode(JSON.stringify(month)).length;
    const bodyBytes = new TextEncoder().encode(body).length;
    expect(bodyBytes).toBeLessThan(fullBytes / 3);
    expect(body).not.toContain('vitalSignsHistory');
    expect(body).toContain('X123456789');
  });
});
