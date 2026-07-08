import { describe, expect, it } from 'vitest';

import {
  buildLogicalSnapshotSheets,
  buildSummaryRows,
  buildUpcPatients,
} from '@/services/exporters/excel/censusHiddenSheetsAggregation';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';
import type { CensusWorkbookSnapshotSheet } from '@/services/exporters/excel/censusHiddenSheetsContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId,
    patientName: 'Paciente Prueba',
    rut: '11.111.111-1',
    age: '45',
    pathology: 'Diagnóstico',
    specialty: Specialty.MEDICINA,
    admissionDate: '2026-03-01',
    status: PatientStatus.ESTABLE,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    ...overrides,
  }) as PatientData;

const buildRecord = (
  date: string,
  beds: Record<string, PatientData>,
  overrides: Partial<DailyRecord> = {}
): DailyRecord => ({
  date,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T10:00:00.000Z`,
  activeExtraBeds: [],
  ...overrides,
});

const buildUpcChecklist = (
  classification: UpcChecklistRecord['classification']
): UpcChecklistRecord => ({
  classification,
  uciCriteria: classification === 'UPC_UCI' ? ['uci_vmi'] : [],
  utiCriteria: classification === 'UPC_UTI' ? ['uti_mon_cardiaca'] : [],
  evaluatedAt: '2026-04-18T10:00:00Z',
});

const buildSnapshotSheet = (
  record: DailyRecord,
  resolvedSheetName: string
): CensusWorkbookSnapshotSheet => ({
  record,
  resolvedSheetName,
  descriptor: {
    recordDate: record.date,
    sheetName: resolvedSheetName,
  },
});

describe('censusHiddenSheetsAggregation', () => {
  it('keeps only one logical snapshot per date and preserves the latest sheet name', () => {
    const record = buildRecord('2026-03-24', { R1: buildPatient('R1') });

    const logicalSheets = buildLogicalSnapshotSheets([
      buildSnapshotSheet(record, '24-03-2026 08-00'),
      buildSnapshotSheet(record, '24-03-2026 10-15'),
    ]);

    expect(logicalSheets).toHaveLength(1);
    expect(logicalSheets[0].displaySheetName).toBe('24-03-2026 10-15');
  });

  it('builds summary rows with occupancy and specialty counts from real patients only', () => {
    const record = buildRecord(
      '2026-03-24',
      {
        R1: buildPatient('R1', {
          specialty: Specialty.MEDICINA,
          clinicalCrib: buildPatient('R1-C', {
            patientName: 'RN UPC',
            specialty: Specialty.PEDIATRIA,
          }),
        }),
        R2: buildPatient('R2', { patientName: '', rut: '', age: '' }),
        R3: buildPatient('R3', { patientName: 'Bloqueada', isBlocked: true }),
      },
      {
        discharges: [
          { status: 'Vivo' } as DailyRecord['discharges'][number],
          { status: 'Fallecido' } as DailyRecord['discharges'][number],
        ],
        transfers: [{ id: 't1' } as DailyRecord['transfers'][number]],
        cma: [{ id: 'c1' } as DailyRecord['cma'][number]],
      }
    );

    const [row] = buildSummaryRows(
      buildLogicalSnapshotSheets([buildSnapshotSheet(record, '24-03-2026')])
    );

    expect(row.displaySheetName).toBe('24-03-2026');
    expect(row.occupiedBeds).toBe(1);
    expect(row.availableCapacity).toBeGreaterThan(0);
    expect(row.occupancyRate).toBe(row.occupiedBeds / (row.occupiedBeds + row.availableCapacity));
    expect(row.discharges).toBe(1);
    expect(row.deceased).toBe(1);
    expect(row.transfers).toBe(1);
    expect(row.cma).toBe(1);
    expect(row.specialtyCounts[Specialty.MEDICINA]).toBe(1);
    expect(row.specialtyCounts[Specialty.PEDIATRIA]).toBe(1);
  });

  it('does not count tombstoned movements in hidden-sheet summary rows', () => {
    const record = buildRecord(
      '2026-03-24',
      { R1: buildPatient('R1') },
      {
        discharges: [
          { id: 'd-active', status: 'Vivo' } as DailyRecord['discharges'][number],
          {
            id: 'd-deleted',
            status: 'Fallecido',
            deletedAt: '2026-03-24T12:00:00.000Z',
          } as DailyRecord['discharges'][number],
        ],
        transfers: [
          { id: 't-active' } as DailyRecord['transfers'][number],
          {
            id: 't-deleted',
            deletedAt: '2026-03-24T12:00:00.000Z',
          } as DailyRecord['transfers'][number],
        ],
        cma: [
          { id: 'c-active' } as DailyRecord['cma'][number],
          {
            id: 'c-deleted',
            deletedAt: '2026-03-24T12:00:00.000Z',
          } as DailyRecord['cma'][number],
        ],
      }
    );

    const [row] = buildSummaryRows(
      buildLogicalSnapshotSheets([buildSnapshotSheet(record, '24-03-2026')])
    );

    expect(row.discharges).toBe(1);
    expect(row.deceased).toBe(0);
    expect(row.transfers).toBe(1);
    expect(row.cma).toBe(1);
  });

  it('aggregates UPC patients across days and marks bed changes', () => {
    const firstDay = buildRecord('2026-03-24', {
      R1: buildPatient('R1', {
        patientName: 'Paciente UPC',
        rut: '12.345.678-9',
        upcChecklist: buildUpcChecklist('UPC_UTI'),
      }),
    });
    const secondDay = buildRecord('2026-03-25', {
      R2: buildPatient('R2', {
        patientName: 'Paciente UPC',
        rut: '12.345.678-9',
        upcChecklist: buildUpcChecklist('UPC_UCI'),
      }),
    });

    const patients = buildUpcPatients(
      buildLogicalSnapshotSheets([
        buildSnapshotSheet(firstDay, '24-03-2026'),
        buildSnapshotSheet(secondDay, '25-03-2026'),
      ])
    );

    expect(patients).toHaveLength(1);
    expect(patients[0].uciDays).toBe(1);
    expect(patients[0].utiDays).toBe(1);
    expect(patients[0].totalDays).toBe(2);
    expect(patients[0].changedBed).toBe(true);
    expect(patients[0].periodLabel).toBe('Mixto');
    expect(patients[0].history).toContain('R1');
    expect(patients[0].history).toContain('R2');
    expect(patients[0].daysDetail).toContain('24-03-2026');
    expect(patients[0].daysDetail).toContain('25-03-2026');
  });

  it('falls back to patient name when UPC patient has no RUT and does not mark change for same bed', () => {
    const firstDay = buildRecord('2026-03-24', {
      R1: buildPatient('R1', {
        patientName: 'Paciente Sin Rut',
        rut: '',
        upcChecklist: buildUpcChecklist('UPC_UTI'),
      }),
    });
    const secondDay = buildRecord('2026-03-25', {
      R1: buildPatient('R1', {
        patientName: 'Paciente Sin Rut',
        rut: '',
        upcChecklist: buildUpcChecklist('UPC_UTI'),
      }),
    });

    const patients = buildUpcPatients(
      buildLogicalSnapshotSheets([
        buildSnapshotSheet(firstDay, '24-03-2026'),
        buildSnapshotSheet(secondDay, '25-03-2026'),
      ])
    );

    expect(patients).toHaveLength(1);
    expect(patients[0].rut).toBe('');
    expect(patients[0].changedBed).toBe(false);
    expect(patients[0].history).toContain('R1 (24-03-2026 a 25-03-2026)');
  });

  it('ignores stale UPC flags on non-eligible beds', () => {
    const patients = buildUpcPatients(
      buildLogicalSnapshotSheets([
        buildSnapshotSheet(
          buildRecord('2026-03-24', {
            H1C1: buildPatient('H1C1', {
              patientName: 'Paciente Sala',
              rut: '22.222.222-2',
              isUPC: true,
            }),
          }),
          '24-03-2026'
        ),
      ])
    );

    expect(patients).toHaveLength(0);
  });

  it('includes eligible beds when the checklist says UPC but the legacy boolean is stale', () => {
    const patients = buildUpcPatients(
      buildLogicalSnapshotSheets([
        buildSnapshotSheet(
          buildRecord('2026-03-24', {
            R1: buildPatient('R1', {
              patientName: 'Paciente Checklist',
              rut: '33.333.333-3',
              isUPC: false,
              upcChecklist: {
                classification: 'UPC_UCI',
                uciCriteria: ['uci_vmi'],
                utiCriteria: [],
                evaluatedAt: '2026-04-18T10:00:00Z',
              },
            }),
          }),
          '24-03-2026'
        ),
      ])
    );

    expect(patients).toHaveLength(1);
    expect(patients[0].rut).toBe('33.333.333-3');
  });

  it('treats legacy UPC checkbox records as UTI on eligible beds', () => {
    const patients = buildUpcPatients(
      buildLogicalSnapshotSheets([
        buildSnapshotSheet(
          buildRecord('2026-03-24', {
            R1: buildPatient('R1', {
              patientName: 'Paciente Legado',
              rut: '44.444.444-4',
              isUPC: true,
            }),
          }),
          '24-03-2026'
        ),
      ])
    );

    expect(patients).toHaveLength(1);
    expect(patients[0].uciDays).toBe(0);
    expect(patients[0].utiDays).toBe(1);
    expect(patients[0].totalDays).toBe(1);
    expect(patients[0].periodLabel).toBe('UTI');
  });
});
